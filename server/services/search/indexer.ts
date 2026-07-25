import { and, eq, isNull, ne, or, sql } from 'drizzle-orm'
import { useDatabase, type Database } from '../../database/client'
import { EMBEDDING_DIMENSIONS, searchDocuments } from '../../database/schema'
import { sha256 } from '../../utils/crypto'
import { createLogger } from '../../utils/logger'
import { createEmbeddings } from '../ai/client'
import { getAiSettings } from '../settings.service'

const log = createLogger('search:index')

export type IndexEntityType = 'material' | 'unterrichtsstunde' | 'reihe'

export interface IndexDocument {
  chunkIndex: number
  title: string
  metaText: string
  content: string
  sourceLabel?: string | null
}

/** Zielgröße eines Textabschnitts in Zeichen – passt zu gängigen Embedding-Fenstern. */
const CHUNK_SIZE = 1600
const CHUNK_OVERLAP = 200
const MAX_CHUNKS_PER_ENTITY = 60

/**
 * Teilt langen Text an Absatz- bzw. Satzgrenzen auf, damit Abschnitte
 * inhaltlich zusammenhängend bleiben.
 */
export function chunkText(text: string): string[] {
  const normalized = text.replace(/\s+\n/g, '\n').trim()
  if (!normalized) return []
  if (normalized.length <= CHUNK_SIZE) return [normalized]

  const chunks: string[] = []
  const paragraphs = normalized.split(/\n{2,}/)
  let current = ''

  const push = () => {
    const trimmed = current.trim()
    if (trimmed) chunks.push(trimmed)
    current = ''
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_SIZE) {
      push()
      // Sehr langer Absatz: an Satzgrenzen zerlegen.
      const sentences = paragraph.split(/(?<=[.!?])\s+/)
      for (const sentence of sentences) {
        if (current.length + sentence.length + 1 > CHUNK_SIZE) {
          const tail = current.slice(-CHUNK_OVERLAP)
          push()
          current = tail
        }
        current += (current ? ' ' : '') + sentence
      }
      continue
    }

    if (current.length + paragraph.length + 2 > CHUNK_SIZE) push()
    current += (current ? '\n\n' : '') + paragraph
  }
  push()

  return chunks.slice(0, MAX_CHUNKS_PER_ENTITY)
}

/** Schreibt die Dokumente einer Entität neu und entfernt überzählige Abschnitte. */
export async function writeDocuments(
  entityType: IndexEntityType,
  entityId: string,
  documents: IndexDocument[],
  db: Database = useDatabase(),
): Promise<void> {
  if (documents.length === 0) {
    await removeFromIndex(entityType, entityId, db)
    return
  }

  for (const doc of documents) {
    const contentHash = sha256(`${doc.title}\u0000${doc.metaText}\u0000${doc.content}`)

    await db
      .insert(searchDocuments)
      .values({
        entityType: entityType,
        entityId,
        chunkIndex: doc.chunkIndex,
        title: doc.title,
        metaText: doc.metaText,
        content: doc.content,
        sourceLabel: doc.sourceLabel ?? null,
        contentHash,
      })
      .onConflictDoUpdate({
        target: [searchDocuments.entityType, searchDocuments.entityId, searchDocuments.chunkIndex],
        set: {
          title: doc.title,
          metaText: doc.metaText,
          content: doc.content,
          sourceLabel: doc.sourceLabel ?? null,
          contentHash,
          updatedAt: new Date(),
          // Inhalt geändert → vorhandenes Embedding ist ungültig.
          embedding: sql`case when ${searchDocuments.contentHash} = ${contentHash}
            then ${searchDocuments.embedding} else null end`,
          embeddingModel: sql`case when ${searchDocuments.contentHash} = ${contentHash}
            then ${searchDocuments.embeddingModel} else null end`,
        },
      })
  }

  await db
    .delete(searchDocuments)
    .where(
      and(
        eq(searchDocuments.entityType, entityType),
        eq(searchDocuments.entityId, entityId),
        sql`${searchDocuments.chunkIndex} >= ${documents.length}`,
      ),
    )
}

export async function removeFromIndex(
  entityType: IndexEntityType,
  entityId: string,
  db: Database = useDatabase(),
): Promise<void> {
  await db
    .delete(searchDocuments)
    .where(
      and(
        eq(searchDocuments.entityType, entityType),
        eq(searchDocuments.entityId, entityId),
      ),
    )
}

// --- Hintergrund-Warteschlange ---------------------------------------------

const pending = new Map<string, { entityType: IndexEntityType; entityId: string }>()
let flushTimer: NodeJS.Timeout | null = null
let flushing = false

/**
 * Merkt eine Entität zur Neuindizierung vor.
 * Mehrfache Änderungen kurz hintereinander werden zusammengefasst, damit
 * Massenoperationen (z. B. Import) den Index nicht dutzendfach neu schreiben.
 */
export function queueReindex(entityType: IndexEntityType, entityId: string): void {
  pending.set(`${entityType}:${entityId}`, { entityType, entityId })

  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null
      void flushIndexQueue()
    }, 750)
    flushTimer.unref?.()
  }
}

export async function flushIndexQueue(): Promise<void> {
  if (flushing) return
  flushing = true

  try {
    while (pending.size > 0) {
      const batch = [...pending.values()]
      pending.clear()

      for (const { entityType, entityId } of batch) {
        try {
          await reindexEntity(entityType, entityId)
        } catch (error) {
          log.warn('Neuindizierung fehlgeschlagen', { entityType, entityId, error })
        }
      }
    }
  } finally {
    flushing = false
  }

  // Embeddings nur nachziehen, wenn ein Anbieter konfiguriert ist.
  void embedPendingDocuments().catch((error) =>
    log.warn('Embeddings konnten nicht erzeugt werden', error),
  )
}

/** Für Tests und den Import: wartet, bis der Index aktuell ist. */
export async function waitForIndex(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  await flushIndexQueue()
}

export async function reindexEntity(
  entityType: IndexEntityType,
  entityId: string,
): Promise<void> {
  const { buildMaterialDocuments, buildLessonDocuments, buildSeriesDocuments } = await import(
    './builders'
  )

  const documents =
    entityType === 'material'
      ? await buildMaterialDocuments(entityId)
      : entityType === 'unterrichtsstunde'
        ? await buildLessonDocuments(entityId)
        : await buildSeriesDocuments(entityId)

  if (!documents) {
    await removeFromIndex(entityType, entityId)
    return
  }

  await writeDocuments(entityType, entityId, documents)
}

// --- Embeddings -------------------------------------------------------------

let embedding = false

/**
 * Berechnet fehlende Vektoren stapelweise nach.
 * Läuft absichtlich außerhalb des Anfragezyklus, damit Speichern und Import
 * nicht durch Wartezeiten des KI-Anbieters blockiert werden.
 */
export async function embedPendingDocuments(limit = 64): Promise<number> {
  if (embedding) return 0

  const settings = await getAiSettings()
  if (!settings.enabled || !settings.embeddingsEnabled || !settings.embeddingModel) return 0

  embedding = true
  try {
    const db = useDatabase()
    const rows = await db
      .select({
        id: searchDocuments.id,
        title: searchDocuments.title,
        metaText: searchDocuments.metaText,
        content: searchDocuments.content,
      })
      .from(searchDocuments)
      .where(
        or(
          isNull(searchDocuments.embedding),
          ne(searchDocuments.embeddingModel, settings.embeddingModel),
        ),
      )
      .limit(limit)

    if (rows.length === 0) return 0

    const inputs = rows.map((row) =>
      [row.title, row.metaText, row.content].filter(Boolean).join('\n').slice(0, 8000),
    )
    const vectors = await createEmbeddings(settings, inputs, EMBEDDING_DIMENSIONS)

    for (const [index, row] of rows.entries()) {
      await db
        .update(searchDocuments)
        .set({
          embedding: vectors[index]!,
          embeddingModel: settings.embeddingModel,
          embeddedAt: new Date(),
        })
        .where(eq(searchDocuments.id, row.id))
    }

    log.info('Embeddings erzeugt', { anzahl: rows.length, modell: settings.embeddingModel })
    return rows.length
  } finally {
    embedding = false
  }
}

/** Wie viele Dokumente noch auf ein Embedding warten. */
export async function getIndexStatus(): Promise<{
  documents: number
  embedded: number
  pending: number
  models: string[]
}> {
  const db = useDatabase()
  const [row] = await db.execute<{
    documents: number
    embedded: number
    models: string[] | null
  }>(
    sql`select count(*)::int as documents,
      count(embedding)::int as embedded,
      array_remove(array_agg(distinct embedding_model), null) as models
      from search_documents`,
  )

  const documents = row?.documents ?? 0
  const embedded = row?.embedded ?? 0
  return { documents, embedded, pending: documents - embedded, models: row?.models ?? [] }
}

/** Verwirft alle Vektoren, z. B. nach einem Modellwechsel. */
export async function clearEmbeddings(): Promise<void> {
  await useDatabase()
    .update(searchDocuments)
    .set({ embedding: null, embeddingModel: null, embeddedAt: null })
}

export async function reindexAll(): Promise<{ materialien: number; stunden: number; reihen: number }> {
  const db = useDatabase()
  const [materialIds, lessonIds, seriesIds] = await Promise.all([
    db.execute<{ id: string }>(sql`select id from materials`),
    db.execute<{ id: string }>(sql`select id from lessons`),
    db.execute<{ id: string }>(sql`select id from series`),
  ])

  for (const { id } of materialIds as unknown as { id: string }[]) {
    await reindexEntity('material', id)
  }
  for (const { id } of lessonIds as unknown as { id: string }[]) {
    await reindexEntity('unterrichtsstunde', id)
  }
  for (const { id } of seriesIds as unknown as { id: string }[]) {
    await reindexEntity('reihe', id)
  }

  return {
    materialien: (materialIds as unknown as unknown[]).length,
    stunden: (lessonIds as unknown as unknown[]).length,
    reihen: (seriesIds as unknown as unknown[]).length,
  }
}
