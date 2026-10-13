import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { resolveEmbeddingModel } from '#shared/utils/embeddings'
import { useDatabase, type Database } from '../../database/client'
import { EMBEDDING_DIMENSIONS, searchDocuments } from '../../database/schema'
import { sha256 } from '../../utils/crypto'
import { createLogger } from '../../utils/logger'
import { createEmbeddings } from '../ai/client'
import { getAiSettings, type AiSettings } from '../settings.service'

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

/** Zerlegt ein Stück, das länger als `max` ist: erst an Zeilen, dann an Leerzeichen, zuletzt hart. */
function kleinTeilen(text: string, max: number): string[] {
  if (text.length <= max) return [text]
  for (const trenner of ['\n', ' ']) {
    const teile = text.split(trenner)
    if (teile.length < 2) continue
    const ergebnis: string[] = []
    let aktuell = ''
    for (const teil of teile) {
      if (aktuell && aktuell.length + trenner.length + teil.length > max) {
        ergebnis.push(aktuell)
        aktuell = ''
      }
      aktuell += (aktuell ? trenner : '') + teil
    }
    if (aktuell) ergebnis.push(aktuell)
    return ergebnis.flatMap((stueck) => kleinTeilen(stueck, max))
  }
  const ergebnis: string[] = []
  for (let i = 0; i < text.length; i += max) ergebnis.push(text.slice(i, i + max))
  return ergebnis
}

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
      // Sehr langer Absatz: an Satzgrenzen zerlegen. Tabellen und Listen aus
      // PDFs haben kaum Satzzeichen – überlange „Sätze“ dann an Zeilen bzw.
      // Leerzeichen teilen, damit kein Abschnitt die Zielgröße sprengt.
      const sentences = paragraph.split(/(?<=[.!?])\s+/).flatMap((satz) => kleinTeilen(satz, CHUNK_SIZE))
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
  void startEmbeddingJob()
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

const EMBED_BATCH_SIZE = 32

/** Modellname, unter dem Vektoren gespeichert und gesucht werden (null = Vektorsuche aus). */
export function activeEmbeddingModel(settings: AiSettings): string | null {
  if (!settings.enabled || !settings.embeddingsEnabled || !settings.embeddingModel) return null
  return resolveEmbeddingModel(settings.provider, settings.embeddingModel)
}

/**
 * Berechnet einen Stapel fehlender oder veralteter Vektoren.
 * Gibt `null` zurück, wenn gerade ein anderer Lauf arbeitet.
 */
async function embedBatch(limit: number): Promise<number | null> {
  if (embedding) return null

  const settings = await getAiSettings()
  const model = activeEmbeddingModel(settings)
  if (!model) return 0

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
          sql`${searchDocuments.embeddingModel} is distinct from ${model}`,
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
          embeddingModel: model,
          embeddedAt: new Date(),
        })
        .where(eq(searchDocuments.id, row.id))
    }

    log.info('Embeddings erzeugt', { anzahl: rows.length, modell: model })
    return rows.length
  } finally {
    embedding = false
  }
}

/**
 * Berechnet fehlende Vektoren stapelweise nach.
 * Läuft absichtlich außerhalb des Anfragezyklus, damit Speichern und Import
 * nicht durch Wartezeiten des KI-Anbieters blockiert werden.
 */
export async function embedPendingDocuments(limit = 64): Promise<number> {
  return (await embedBatch(limit)) ?? 0
}

export interface EmbeddingJobState {
  running: boolean
  /** Letzte Fehlermeldung des Laufs; wird beim nächsten Start gelöscht. */
  error: string | null
}

const embeddingJob: EmbeddingJobState = { running: false, error: null }

/**
 * Arbeitet alle offenen Vektoren in Stapeln ab, bis nichts mehr aussteht.
 * Mehrfache Aufrufe laufen in denselben Lauf hinein. Bei einem Fehler (z. B.
 * Anbieter nicht erreichbar) stoppt der Lauf und merkt sich die Meldung.
 */
export function startEmbeddingJob(): Promise<void> | null {
  if (embeddingJob.running) return null
  embeddingJob.running = true
  embeddingJob.error = null

  return (async () => {
    try {
      for (;;) {
        const done = await embedBatch(EMBED_BATCH_SIZE)
        if (done === null) {
          // Ein Einzelstapel aus der Änderungswarteschlange arbeitet gerade.
          await new Promise((resolve) => setTimeout(resolve, 500))
          continue
        }
        if (done === 0) break
      }
    } catch (error) {
      embeddingJob.error = error instanceof Error ? error.message : 'Unbekannter Fehler'
      log.warn('Embedding-Lauf abgebrochen', error)
    } finally {
      embeddingJob.running = false
    }
  })()
}

export interface IndexStatus {
  documents: number
  /** Chunks mit Vektor des aktuell eingestellten Modells. */
  embedded: number
  pending: number
  /** Chunks mit Vektor eines anderen Modells – für die Suche derzeit unbrauchbar. */
  outdated: number
  /** In der Datenbank vorkommende Modelle. */
  models: string[]
  /** Aktuell wirksames Modell; null, wenn die Vektorsuche aus ist. */
  currentModel: string | null
  job: EmbeddingJobState
}

/** Wie viele Dokumente noch auf ein Embedding warten. */
export async function getIndexStatus(): Promise<IndexStatus> {
  const db = useDatabase()
  const currentModel = activeEmbeddingModel(await getAiSettings())

  const [row] = await db.execute<{
    documents: number
    embedded: number
    outdated: number
    models: string[] | null
  }>(
    sql`select count(*)::int as documents,
      (count(*) filter (where embedding is not null
        and embedding_model = ${currentModel}::text))::int as embedded,
      (count(*) filter (where embedding is not null
        and embedding_model is distinct from ${currentModel}::text))::int as outdated,
      array_remove(array_agg(distinct embedding_model), null) as models
      from search_documents`,
  )

  const documents = row?.documents ?? 0
  const embedded = row?.embedded ?? 0
  return {
    documents,
    embedded,
    pending: documents - embedded,
    outdated: row?.outdated ?? 0,
    models: row?.models ?? [],
    currentModel,
    job: { ...embeddingJob },
  }
}

/** Verwirft alle Vektoren, z. B. um sie mit demselben Modell frisch zu berechnen. */
export async function clearEmbeddings(): Promise<void> {
  await useDatabase()
    .update(searchDocuments)
    .set({ embedding: null, embeddingModel: null, embeddedAt: null })
}

/**
 * Ältere Versionen haben Tabellen und Listen ohne Satzzeichen nicht zerteilt,
 * sodass einzelne Abschnitte viele tausend Zeichen lang wurden (zu groß für
 * Embedding-Modelle). Betroffene Einträge werden einmalig neu aufgebaut.
 * Der Metadaten-Abschnitt 0 eines Materials darf länger sein und zählt nicht.
 */
export async function ueberlangeAbschnitteNeuAufbauen(db: Database = useDatabase()): Promise<number> {
  const betroffen = (await db.execute(sql`
    select distinct entity_type as "entityType", entity_id as "entityId"
    from search_documents
    where length(content) > ${CHUNK_SIZE * 2}
      and not (entity_type = 'material' and chunk_index = 0)
  `)) as unknown as Array<{ entityType: IndexEntityType; entityId: string }>

  for (const { entityType, entityId } of betroffen) queueReindex(entityType, entityId)
  if (betroffen.length) log.info('Überlange Suchabschnitte werden neu aufgebaut', { anzahl: betroffen.length })
  return betroffen.length
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
