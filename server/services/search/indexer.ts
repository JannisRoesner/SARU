import { and, eq, inArray, isNotNull, isNull, notInArray, or, sql } from 'drizzle-orm'
import {
  embeddingDocumentInput,
  embeddingIndexKey,
  resolveEmbeddingModel,
  supportsImageEmbeddings,
} from '#shared/utils/embeddings'
import { useDatabase, type Database } from '../../database/client'
import { EMBEDDING_DIMENSIONS, searchDocuments, type SearchImageSource } from '../../database/schema'
import { sha256 } from '../../utils/crypto'
import { createLogger } from '../../utils/logger'
import { createEmbeddings, type EmbeddingImage } from '../ai/client'
import { aiVerbindung, getAiSettings, gleicheVerbindung, type AiSettings } from '../settings.service'

const log = createLogger('search:index')

export type IndexEntityType = 'material' | 'unterrichtsstunde' | 'reihe' | 'abbildung'

export interface IndexDocument {
  chunkIndex: number
  title: string
  metaText: string
  content: string
  sourceLabel?: string | null
  /** Abschnitt steht für ein Seitenbild; der Vektor entsteht aus dem Bild statt aus dem Text. */
  imageSource?: SearchImageSource & { checksum: string | null }
}

/** Seitenbilder bekommen einen eigenen Nummernbereich, damit sie sich nicht mit dem Text verschieben. */
export const IMAGE_CHUNK_START = 1000

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
    // Ein Seitenbild ändert sich nur mit der Datei, nicht mit Titel oder Metadaten.
    const contentHash = doc.imageSource
      ? sha256(['bild', doc.imageSource.assetId, doc.imageSource.page, doc.imageSource.checksum ?? ''].join('\u0000'))
      : sha256(`${doc.title}\u0000${doc.metaText}\u0000${doc.content}`)
    const imageSource = doc.imageSource
      ? { assetId: doc.imageSource.assetId, page: doc.imageSource.page }
      : null

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
        imageSource,
        contentHash,
      })
      .onConflictDoUpdate({
        target: [searchDocuments.entityType, searchDocuments.entityId, searchDocuments.chunkIndex],
        set: {
          title: doc.title,
          metaText: doc.metaText,
          content: doc.content,
          sourceLabel: doc.sourceLabel ?? null,
          imageSource,
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
        notInArray(
          searchDocuments.chunkIndex,
          documents.map((doc) => doc.chunkIndex),
        ),
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
  const { buildAbbildungDocuments, buildMaterialDocuments, buildLessonDocuments, buildSeriesDocuments } =
    await import('./builders')

  const documents =
    entityType === 'material'
      ? await buildMaterialDocuments(entityId)
      : entityType === 'unterrichtsstunde'
        ? await buildLessonDocuments(entityId)
        : entityType === 'abbildung'
          ? await buildAbbildungDocuments(entityId)
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

/** Kennung, unter der Vektoren gespeichert und gesucht werden (null = Vektorsuche aus). */
export function activeEmbeddingModel(settings: AiSettings): string | null {
  if (!settings.enabled || !settings.embeddingsEnabled || !settings.embeddingModel) return null
  return embeddingIndexKey(resolveEmbeddingModel(aiVerbindung(settings, 'embedding').provider, settings.embeddingModel))
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
  const modelName = resolveEmbeddingModel(aiVerbindung(settings, 'embedding').provider, settings.embeddingModel)

  embedding = true
  try {
    const db = useDatabase()
    const veraltet = or(
      isNull(searchDocuments.embedding),
      sql`${searchDocuments.embeddingModel} is distinct from ${model}`,
    )

    // Texte zuerst: Sie sind schnell berechnet, und ein Server ohne Bildunterstützung
    // soll die Textsuche nicht aufhalten.
    const rows = await db
      .select({
        id: searchDocuments.id,
        title: searchDocuments.title,
        metaText: searchDocuments.metaText,
        content: searchDocuments.content,
      })
      .from(searchDocuments)
      .where(and(veraltet, isNull(searchDocuments.imageSource)))
      .limit(limit)

    if (rows.length === 0) {
      return imageEmbeddingsActive(settings) ? await embedImageBatch(settings, model, veraltet) : 0
    }

    const inputs = rows.map((row) =>
      embeddingDocumentInput(
        modelName,
        row.title,
        [row.metaText, row.content].filter(Boolean).join('\n'),
      ).slice(0, 8000),
    )
    const vectors = await createEmbeddings(settings, inputs, EMBEDDING_DIMENSIONS)
    await saveVectors(rows.map((row) => row.id), vectors, model)

    log.info('Embeddings erzeugt', { anzahl: rows.length, modell: model })
    return rows.length
  } finally {
    embedding = false
  }
}

async function saveVectors(ids: string[], vectors: number[][], model: string): Promise<void> {
  const db = useDatabase()
  for (const [index, id] of ids.entries()) {
    await db
      .update(searchDocuments)
      .set({
        embedding: vectors[index]!,
        embeddingModel: model,
        embeddedAt: new Date(),
      })
      .where(eq(searchDocuments.id, id))
  }
}

/** Seitenbilder in kleinen Stapeln – jedes Bild kostet deutlich mehr als ein Textabschnitt. */
const IMAGE_BATCH_SIZE = 4

async function embedImageBatch(
  settings: AiSettings,
  model: string,
  veraltet: ReturnType<typeof or>,
): Promise<number> {
  const db = useDatabase()
  const rows = await db
    .select({ id: searchDocuments.id, imageSource: searchDocuments.imageSource })
    .from(searchDocuments)
    .where(and(veraltet, isNotNull(searchDocuments.imageSource)))
    .orderBy(sql`${searchDocuments.imageSource}->>'assetId'`, sql`(${searchDocuments.imageSource}->>'page')::int`)
    .limit(IMAGE_BATCH_SIZE)

  if (rows.length === 0) return 0

  // Je Datei nur einmal laden bzw. konvertieren.
  const { seitenRendern } = await import('./seitenbilder')
  const seitenJeDatei = new Map<string, number[]>()
  for (const row of rows) {
    const { assetId, page } = row.imageSource!
    seitenJeDatei.set(assetId, [...(seitenJeDatei.get(assetId) ?? []), page])
  }
  const bilder = new Map<string, EmbeddingImage>()
  for (const [assetId, seiten] of seitenJeDatei) {
    for (const [seite, bild] of await seitenRendern(assetId, seiten)) bilder.set(`${assetId}:${seite}`, bild)
  }

  const fertig = rows.filter((row) => bilder.has(`${row.imageSource!.assetId}:${row.imageSource!.page}`))
  const fehlend = rows.filter((row) => !fertig.includes(row))
  if (fehlend.length > 0) {
    // Nicht renderbar (Datei fehlt, LibreOffice nicht installiert …): Abschnitt entfernen,
    // sonst würde der Lauf ihn endlos erneut versuchen. Die nächste Neuindizierung legt ihn wieder an.
    log.warn('Seitenbilder konnten nicht erzeugt werden und werden übersprungen', { anzahl: fehlend.length })
    await db.delete(searchDocuments).where(
      inArray(
        searchDocuments.id,
        fehlend.map((row) => row.id),
      ),
    )
  }
  if (fertig.length === 0) return rows.length

  let vectors: number[][]
  try {
    vectors = await createEmbeddings(
      settings,
      fertig.map((row) => bilder.get(`${row.imageSource!.assetId}:${row.imageSource!.page}`)!),
      EMBEDDING_DIMENSIONS,
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unbekannter Fehler'
    throw new Error(
      `Seitenbilder konnten nicht eingebettet werden. Nimmt der Server Bilder an (llama.cpp: Modell mit --mmproj starten)? ${detail}`,
      { cause: error },
    )
  }
  await saveVectors(fertig.map((row) => row.id), vectors, model)

  log.info('Seitenbild-Embeddings erzeugt', { anzahl: fertig.length, modell: model })
  return rows.length
}

/** Ob Seitenbilder indiziert und eingebettet werden. */
export function imageEmbeddingsActive(settings: AiSettings): boolean {
  return Boolean(
    settings.embedImages &&
      activeEmbeddingModel(settings) &&
      supportsImageEmbeddings(aiVerbindung(settings, 'embedding').provider),
  )
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
  /** Davon Seitenbilder (zählen in `documents`, `embedded` und `pending` mit). */
  images: number
  imagesEmbedded: number
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
    images: number
    imagesEmbedded: number
    models: string[] | null
  }>(
    sql`select count(*)::int as documents,
      (count(*) filter (where embedding is not null
        and embedding_model = ${currentModel}::text))::int as embedded,
      (count(*) filter (where embedding is not null
        and embedding_model is distinct from ${currentModel}::text))::int as outdated,
      (count(*) filter (where image_source is not null))::int as images,
      (count(*) filter (where image_source is not null and embedding is not null
        and embedding_model = ${currentModel}::text))::int as "imagesEmbedded",
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
    images: row?.images ?? 0,
    imagesEmbedded: row?.imagesEmbedded ?? 0,
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
 * Gleicher Modellname, aber ein anderer Server: Die gespeicherten Vektoren tragen
 * dieselbe Kennung, stammen aber womöglich aus einem anderen Modell (etwa einem
 * llama.cpp-Alias). Dann werden sie verworfen und vollständig neu berechnet,
 * damit die Suche nie Vektoren zweier Modelle vergleicht. Ein neuer Modellname
 * braucht das nicht – dessen Vektoren gelten ohnehin als veraltet.
 */
export async function embeddingsNachAnbieterwechselVerwerfen(
  vorher: AiSettings,
  nachher: AiSettings,
): Promise<boolean> {
  const modell = activeEmbeddingModel(vorher)
  if (modell === null || modell !== activeEmbeddingModel(nachher)) return false
  if (gleicheVerbindung(aiVerbindung(vorher, 'embedding'), aiVerbindung(nachher, 'embedding'))) return false
  await clearEmbeddings()
  log.info('Embedding-Server gewechselt – Vektoren werden neu berechnet', {
    modell,
    provider: aiVerbindung(nachher, 'embedding').provider,
  })
  return true
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

export async function reindexAll(): Promise<{ materialien: number; stunden: number; reihen: number; abbildungen: number }> {
  const db = useDatabase()
  const [materialIds, lessonIds, seriesIds, abbildungIds] = await Promise.all([
    db.execute<{ id: string }>(sql`select id from materials`),
    db.execute<{ id: string }>(sql`select id from lessons`),
    db.execute<{ id: string }>(sql`select id from series`),
    db.execute<{ id: string }>(sql`select id from material_abbildungen`),
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
  for (const { id } of abbildungIds as unknown as { id: string }[]) {
    await reindexEntity('abbildung', id)
  }
  // Abschnitte gelöschter Bilder (z. B. nach Löschen eines Anhangs) aufräumen.
  await db.execute(sql`delete from search_documents d where d.entity_type = 'abbildung'
    and not exists (select 1 from material_abbildungen a where a.id = d.entity_id)`)

  return {
    materialien: (materialIds as unknown as unknown[]).length,
    stunden: (lessonIds as unknown as unknown[]).length,
    reihen: (seriesIds as unknown as unknown[]).length,
    abbildungen: (abbildungIds as unknown as unknown[]).length,
  }
}

/**
 * Reiht alle Materialien zur Neuindizierung ein, z. B. wenn Seitenbilder ein-
 * oder ausgeschaltet werden. Läuft im Hintergrund über die Warteschlange.
 */
export async function materialienNeuIndizieren(db: Database = useDatabase()): Promise<number> {
  const ids = (await db.execute(sql`select id from materials`)) as unknown as { id: string }[]
  for (const { id } of ids) queueReindex('material', id)
  return ids.length
}
