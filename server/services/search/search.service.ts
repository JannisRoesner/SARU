import { resolveEmbeddingModel } from '#shared/utils/embeddings'
import { sql } from 'drizzle-orm'
import { queryRows, useDatabase, type Database } from '../../database/client'
import { EMBEDDING_DIMENSIONS } from '../../database/schema'
import { createLogger } from '../../utils/logger'
import { createEmbeddings } from '../ai/client'
import { getAiSettings } from '../settings.service'
import type { IndexEntityType } from './indexer'

const log = createLogger('search')

export interface SearchHit {
  entityType: IndexEntityType
  entityId: string
  title: string
  /** Hervorgehobener Textausschnitt mit <mark>-Auszeichnung. */
  snippet: string | null
  sourceLabel: string | null
  score: number
  /** Woher der Treffer stammt – für die Anzeige „auch im Dokumenttext gefunden“. */
  matchedIn: ('titel' | 'metadaten' | 'inhalt')[]
  usedVectorSearch: boolean
}

export interface SearchOptions {
  entityTypes?: IndexEntityType[]
  /** Wie viele Kandidaten pro Entitätstyp geliefert werden. */
  limit?: number
  /** Semantische Suche überspringen (z. B. für Autovervollständigung). */
  skipVector?: boolean
}

export interface SearchOutcome {
  hits: SearchHit[]
  /** Nach Typ gruppierte IDs in Relevanzreihenfolge. */
  idsByType: Record<IndexEntityType, string[]>
  vectorSearchUsed: boolean
  totalCandidates: number
}

const EMPTY_OUTCOME: SearchOutcome = {
  hits: [],
  idsByType: { material: [], unterrichtsstunde: [], reihe: [] },
  vectorSearchUsed: false,
  totalCandidates: 0,
}

/** Gewichte der drei Rangfolgen in der Reciprocal-Rank-Fusion. */
const WEIGHTS = { fts: 1, trigram: 0.5, vector: 0.9 }
/** Dämpfungskonstante der RRF – üblich ist 60. */
const RRF_K = 60

/** Kleiner Zwischenspeicher für Anfragevektoren, damit Tippen nicht jedes Mal kostet. */
const embeddingCache = new Map<string, number[]>()
const EMBEDDING_CACHE_MAX = 200

async function embedQuery(query: string): Promise<number[] | null> {
  const settings = await getAiSettings()
  if (!settings.enabled || !settings.embeddingsEnabled || !settings.embeddingModel) return null

  const model = resolveEmbeddingModel(settings.provider, settings.embeddingModel)
  const key = `${model}:${query}`
  const cached = embeddingCache.get(key)
  if (cached) return cached

  try {
    const [vector] = await createEmbeddings(settings, [query], EMBEDDING_DIMENSIONS)
    if (!vector) return null

    if (embeddingCache.size >= EMBEDDING_CACHE_MAX) {
      embeddingCache.delete(embeddingCache.keys().next().value as string)
    }
    embeddingCache.set(key, vector)
    return vector
  } catch (error) {
    // Die lexikalische Suche funktioniert weiter – Semantik ist nur eine Zutat.
    log.warn('Anfragevektor konnte nicht erzeugt werden, Suche läuft ohne Semantik weiter', error)
    return null
  }
}

interface RawHit {
  entityType: IndexEntityType
  entityId: string
  title: string
  snippet: string | null
  sourceLabel: string | null
  score: number
  ftsRank: number | null
  trigramRank: number | null
  vectorRank: number | null
  titleMatch: boolean
  metaMatch: boolean
  contentMatch: boolean
}

export async function search(
  query: string,
  options: SearchOptions = {},
  db: Database = useDatabase(),
): Promise<SearchOutcome> {
  const trimmed = query.trim()
  if (!trimmed) return EMPTY_OUTCOME

  const limit = Math.min(500, Math.max(1, options.limit ?? 200))
  const types = options.entityTypes?.length
    ? options.entityTypes
    : (['material', 'unterrichtsstunde', 'reihe'] as IndexEntityType[])

  const queryVector = options.skipVector ? null : await embedQuery(trimmed)
  const vectorLiteral = queryVector ? `[${queryVector.join(',')}]` : null

  const rows = await queryRows<RawHit>(db, 
    sql`
    with parameter as (
      select
        websearch_to_tsquery('german', ${trimmed}) as tsq,
        ${trimmed}::text as raw,
        array[${sql.join(
          types.map((type) => sql`${type}`),
          sql`, `,
        )}]::search_entity_type[] as types
    ),
    -- 1. Lexikalische Volltextsuche mit deutscher Stammformreduktion.
    fts as (
      select d.entity_type, d.entity_id,
        max(ts_rank_cd(d.tsv, p.tsq)) as score,
        (array_agg(d.id order by ts_rank_cd(d.tsv, p.tsq) desc))[1] as best_document
      from search_documents d, parameter p
      where d.entity_type = any(p.types) and d.tsv @@ p.tsq
      group by d.entity_type, d.entity_id
      order by score desc
      limit ${limit}
    ),
    -- 2. Trigramm-Ähnlichkeit auf dem Titel fängt Tippfehler und Wortteile ab.
    trigram as (
      select d.entity_type, d.entity_id,
        max(similarity(d.title, p.raw)) as score,
        (array_agg(d.id order by similarity(d.title, p.raw) desc))[1] as best_document
      from search_documents d, parameter p
      where d.entity_type = any(p.types) and d.chunk_index = 0
        and similarity(d.title, p.raw) > 0.15
      group by d.entity_type, d.entity_id
      order by score desc
      limit ${limit}
    ),
    -- 3. Semantische Nachbarschaft, nur wenn ein Anfragevektor vorliegt.
    vector as (
      select d.entity_type, d.entity_id,
        max(1 - (d.embedding <=> ${vectorLiteral}::vector)) as score,
        (array_agg(d.id order by (d.embedding <=> ${vectorLiteral}::vector) asc))[1] as best_document
      from search_documents d, parameter p
      where ${vectorLiteral}::text is not null
        and d.entity_type = any(p.types) and d.embedding is not null
      group by d.entity_type, d.entity_id
      order by score desc
      limit ${limit}
    ),
    ranked as (
      select entity_type, entity_id, best_document,
        rank() over (partition by entity_type order by score desc) as position,
        'fts' as source
      from fts
      union all
      select entity_type, entity_id, best_document,
        rank() over (partition by entity_type order by score desc), 'trigram'
      from trigram
      union all
      select entity_type, entity_id, best_document,
        rank() over (partition by entity_type order by score desc), 'vector'
      from vector
    ),
    fused as (
      select entity_type, entity_id,
        sum(
          case source
            when 'fts' then ${WEIGHTS.fts}::float8
            when 'trigram' then ${WEIGHTS.trigram}::float8
            else ${WEIGHTS.vector}::float8
          end / (${RRF_K}::float8 + position)
        ) as score,
        min(case when source = 'fts' then position end) as fts_rank,
        min(case when source = 'trigram' then position end) as trigram_rank,
        min(case when source = 'vector' then position end) as vector_rank,
        (array_agg(best_document order by
          case source when 'fts' then 0 when 'vector' then 1 else 2 end))[1] as best_document
      from ranked
      group by entity_type, entity_id
    )
    select
      f.entity_type as "entityType",
      f.entity_id as "entityId",
      d.title,
      f.score::float8 as score,
      f.fts_rank::int as "ftsRank",
      f.trigram_rank::int as "trigramRank",
      f.vector_rank::int as "vectorRank",
      d.source_label as "sourceLabel",
      nullif(ts_headline('german', coalesce(nullif(d.content, ''), d.meta_text), p.tsq,
        'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=28, MinWords=8, FragmentDelimiter=" … "'
      ), '') as snippet,
      to_tsvector('german', d.title) @@ p.tsq as "titleMatch",
      to_tsvector('german', d.meta_text) @@ p.tsq as "metaMatch",
      to_tsvector('german', d.content) @@ p.tsq as "contentMatch"
    from fused f
    join search_documents d on d.id = f.best_document
    cross join parameter p
    order by f.score desc
    limit ${limit}`,
  )

  const hits: SearchHit[] = (rows as unknown as RawHit[]).map((row) => {
    const matchedIn: SearchHit['matchedIn'] = []
    if (row.titleMatch || row.trigramRank !== null) matchedIn.push('titel')
    if (row.metaMatch) matchedIn.push('metadaten')
    if (row.contentMatch) matchedIn.push('inhalt')

    return {
      entityType: row.entityType,
      entityId: row.entityId,
      title: row.title,
      snippet: row.snippet,
      sourceLabel: row.sourceLabel,
      score: Number(row.score),
      matchedIn,
      usedVectorSearch: row.vectorRank !== null,
    }
  })

  const idsByType: Record<IndexEntityType, string[]> = {
    material: [],
    unterrichtsstunde: [],
    reihe: [],
  }
  for (const hit of hits) idsByType[hit.entityType].push(hit.entityId)

  return {
    hits,
    idsByType,
    vectorSearchUsed: queryVector !== null && hits.some((hit) => hit.usedVectorSearch),
    totalCandidates: hits.length,
  }
}

export interface Suggestion {
  value: string
  kind: 'material' | 'unterrichtsstunde' | 'reihe' | 'schlagwort' | 'thema' | 'fach' | 'verlauf'
  entityId?: string
  count?: number
}

/**
 * Vorschläge für die Suchleiste: Titel, Schlagwörter, Themen, Fächer und die
 * eigene Suchhistorie. Bewusst rein lexikalisch, damit die Antwort schnell ist.
 */
export async function suggest(
  prefix: string,
  userId: string,
  limit = 10,
  db: Database = useDatabase(),
): Promise<Suggestion[]> {
  const trimmed = prefix.trim()
  if (trimmed.length < 2) return []
  const pattern = `%${trimmed}%`

  const rows = await queryRows<Suggestion>(db, 
    sql`
    (select h.query as value, 'verlauf' as kind, null::uuid as "entityId", null::int as count
      from search_history h
      where h.user_id = ${userId}::uuid and h.query ilike ${pattern}
      group by h.query order by max(h.created_at) desc limit 3)
    union all
    (select m.title, 'material', m.id, null::int from materials m
      where m.is_archived = false and m.title ilike ${pattern}
      order by similarity(m.title, ${trimmed}) desc limit ${limit})
    union all
    (select l.title, 'unterrichtsstunde', l.id, null::int from lessons l
      where l.title ilike ${pattern}
      order by similarity(l.title, ${trimmed}) desc limit 5)
    union all
    (select r.title, 'reihe', r.id, null::int from series r
      where r.title ilike ${pattern}
      order by similarity(r.title, ${trimmed}) desc limit 5)
    union all
    (select t.name, 'schlagwort', t.id,
      (select count(*)::int from material_tags mt where mt.tag_id = t.id)
      from tags t where t.name ilike ${pattern} limit 5)
    union all
    (select t.name, 'thema', t.id,
      (select count(*)::int from material_topics mt where mt.topic_id = t.id)
      from topics t where t.name ilike ${pattern} limit 5)
    union all
    (select s.name, 'fach', s.id,
      (select count(*)::int from material_subjects ms where ms.subject_id = s.id)
      from subjects s where s.name ilike ${pattern} limit 5)`,
  )

  // Doppelte Beschriftungen entfernen, Verlauf und Titel bevorzugen.
  const seen = new Set<string>()
  const result: Suggestion[] = []
  for (const row of rows as unknown as Suggestion[]) {
    const key = `${row.kind}:${row.value.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(row)
  }
  return result.slice(0, 15)
}

export async function recordSearch(
  userId: string,
  query: string,
  resultCount: number,
  db: Database = useDatabase(),
): Promise<void> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return

  await db.execute(
    sql`insert into search_history (user_id, query, result_count)
      values (${userId}::uuid, ${trimmed}, ${resultCount})`,
  )
}
