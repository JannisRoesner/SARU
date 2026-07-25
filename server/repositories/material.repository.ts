import { type SQL, sql } from 'drizzle-orm'
import { queryRows, useDatabase, type Database } from '../database/client'
import type { AiMeta } from '../database/schema'
import type { MaterialType, Origin, SchoolForm } from '#shared/types/domain'

export interface MaterialFilters {
  subjectIds?: string[]
  topicIds?: string[]
  tagIds?: string[]
  competencyIds?: string[]
  learningGroupIds?: string[]
  gradeLevels?: number[]
  materialTypes?: string[]
  schoolForms?: string[]
  /** Dateiendungen, z. B. `pdf`. */
  fileTypes?: string[]
  origin?: string[]
  dateFrom?: string
  dateTo?: string
  onlyFavorites?: boolean
  includeArchived?: boolean
  /** Nur Materialien ohne zugeordnete Musterlösung. */
  missingSolution?: boolean
  ownerId?: string
  /** Beschränkt auf eine Menge von IDs – wird von der Volltextsuche genutzt. */
  ids?: string[]
}

export type MaterialSort =
  | 'relevanz'
  | 'datum_neu'
  | 'datum_alt'
  | 'titel'
  | 'zuletzt_verwendet'
  | 'bewertung'
  | 'verwendung'

export type MaterialTaxonomyRef = {
  id: string
  name: string
  color?: string | null
}

export type MaterialPreview = {
  assetId: string
  kind: 'datei' | 'link'
  mimeType: string | null
  fileName: string | null
  url: string | null
  extension: string | null
}

export type MaterialSummary = {
  id: string
  title: string
  description: string | null
  materialType: MaterialType
  origin: Origin
  aiMeta: AiMeta | null
  schoolForm: SchoolForm | null
  author: string | null
  source: string | null
  pages: string | null
  rating: number | null
  isFavorite: boolean
  isArchived: boolean
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
  subjects: MaterialTaxonomyRef[]
  topics: MaterialTaxonomyRef[]
  tags: MaterialTaxonomyRef[]
  gradeLevels: number[]
  variantCount: number
  assetCount: number
  fileTypes: string[]
  preview: MaterialPreview | null
  /** Anzahl der Verwendungen in Stunden und Reihen. */
  usageCount: number
  hasSolution: boolean
  aiSolutionCount: number
}

/**
 * Aggregiert die Verknüpfungen eines Materials als JSON.
 * Zusammengefasst in einem Ausdruck, damit Liste und Detailansicht identische
 * Felder liefern und keine N+1-Abfragen entstehen.
 */
const summarySelection = sql`
  m.id,
  m.title,
  m.description,
  m.material_type      as "materialType",
  m.origin,
  m.ai_meta            as "aiMeta",
  m.school_form        as "schoolForm",
  m.author,
  m.source,
  m.pages,
  m.rating,
  m.is_favorite        as "isFavorite",
  m.is_archived        as "isArchived",
  m.created_at         as "createdAt",
  m.updated_at         as "updatedAt",
  m.last_used_at       as "lastUsedAt",
  coalesce((
    select json_agg(json_build_object('id', s.id, 'name', s.name, 'color', s.color) order by s.name)
    from material_subjects ms join subjects s on s.id = ms.subject_id
    where ms.material_id = m.id
  ), '[]'::json) as "subjects",
  coalesce((
    select json_agg(json_build_object('id', t.id, 'name', t.name) order by t.name)
    from material_topics mt join topics t on t.id = mt.topic_id
    where mt.material_id = m.id
  ), '[]'::json) as "topics",
  coalesce((
    select json_agg(json_build_object('id', tg.id, 'name', tg.name, 'color', tg.color) order by tg.name)
    from material_tags mtg join tags tg on tg.id = mtg.tag_id
    where mtg.material_id = m.id
  ), '[]'::json) as "tags",
  coalesce((
    select json_agg(mgl.grade_level order by mgl.grade_level)
    from material_grade_levels mgl where mgl.material_id = m.id
  ), '[]'::json) as "gradeLevels",
  (select count(*)::int from material_variants v where v.material_id = m.id) as "variantCount",
  (
    select count(*)::int from material_assets a
    join material_variants v on v.id = a.variant_id
    where v.material_id = m.id
  ) as "assetCount",
  coalesce((
    select json_agg(distinct lower(split_part(a.file_name, '.', array_length(string_to_array(a.file_name, '.'), 1))))
    from material_assets a
    join material_variants v on v.id = a.variant_id
    where v.material_id = m.id and a.file_name is not null
  ), '[]'::json) as "fileTypes",
  (
    -- Vorschau: bevorzugt das Hauptmedium der Standardvariante.
    select json_build_object(
      'assetId', a.id, 'kind', a.kind, 'mimeType', a.mime_type,
      'fileName', a.file_name, 'url', a.url,
      'extension', lower(split_part(coalesce(a.file_name, ''), '.', array_length(string_to_array(coalesce(a.file_name, ''), '.'), 1)))
    )
    from material_assets a
    join material_variants v on v.id = a.variant_id
    where v.material_id = m.id
    order by v.is_default desc, v.sort_order, a.role, a.sort_order
    limit 1
  ) as "preview",
  (
    (select count(*)::int from lesson_materials lm where lm.material_id = m.id)
    + (select count(*)::int from series_materials sm where sm.material_id = m.id)
  ) as "usageCount",
  exists(
    select 1 from material_relations r
    where r.from_material_id = m.id and r.relation_type in ('musterloesung', 'loesung')
  ) as "hasSolution",
  (
    select count(*)::int from material_relations r
    join materials sol on sol.id = r.to_material_id
    where r.from_material_id = m.id and r.relation_type in ('musterloesung', 'loesung')
      and sol.origin = 'ki'
  ) as "aiSolutionCount"
`

/**
 * Baut ein PostgreSQL-Array aus Einzelparametern.
 * Ein direkt eingesetztes JS-Array würde als Zeichenkette übergeben und von
 * PostgreSQL abgelehnt („malformed array literal“).
 */
function pgArray(values: readonly (string | number)[], cast: string): SQL {
  if (values.length === 0) return sql`array[]::${sql.raw(cast)}`
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::${sql.raw(cast)}`
}

function buildConditions(filters: MaterialFilters): SQL[] {
  const conditions: SQL[] = []

  if (!filters.includeArchived) conditions.push(sql`m.is_archived = false`)
  if (filters.onlyFavorites) conditions.push(sql`m.is_favorite = true`)
  if (filters.ownerId) conditions.push(sql`m.owner_id = ${filters.ownerId}`)

  if (filters.ids) {
    if (filters.ids.length === 0) return [sql`false`]
    conditions.push(sql`m.id = any(${pgArray(filters.ids, 'uuid[]')})`)
  }

  if (filters.materialTypes?.length) {
    conditions.push(sql`m.material_type = any(${pgArray(filters.materialTypes, 'material_type[]')})`)
  }
  if (filters.schoolForms?.length) {
    conditions.push(sql`m.school_form = any(${pgArray(filters.schoolForms, 'school_form[]')})`)
  }
  if (filters.origin?.length) {
    conditions.push(sql`m.origin = any(${pgArray(filters.origin, 'origin[]')})`)
  }
  if (filters.dateFrom) conditions.push(sql`m.updated_at >= ${filters.dateFrom}::timestamptz`)
  if (filters.dateTo) {
    // Bis-Datum einschließlich des ganzen Tages.
    conditions.push(sql`m.updated_at < (${filters.dateTo}::date + interval '1 day')`)
  }

  if (filters.subjectIds?.length) {
    conditions.push(
      sql`exists (select 1 from material_subjects x where x.material_id = m.id and x.subject_id = any(${pgArray(filters.subjectIds, 'uuid[]')}))`,
    )
  }
  if (filters.topicIds?.length) {
    // Unterthemen zählen mit, wenn das Oberthema gefiltert wird.
    conditions.push(
      sql`exists (
        select 1 from material_topics x
        join topics t on t.id = x.topic_id
        where x.material_id = m.id
          and (t.id = any(${pgArray(filters.topicIds, 'uuid[]')}) or t.parent_id = any(${pgArray(filters.topicIds, 'uuid[]')}))
      )`,
    )
  }
  if (filters.tagIds?.length) {
    conditions.push(
      sql`exists (select 1 from material_tags x where x.material_id = m.id and x.tag_id = any(${pgArray(filters.tagIds, 'uuid[]')}))`,
    )
  }
  if (filters.competencyIds?.length) {
    conditions.push(
      sql`exists (select 1 from material_competencies x where x.material_id = m.id and x.competency_id = any(${pgArray(filters.competencyIds, 'uuid[]')}))`,
    )
  }
  if (filters.learningGroupIds?.length) {
    conditions.push(
      sql`exists (select 1 from material_learning_groups x where x.material_id = m.id and x.learning_group_id = any(${pgArray(filters.learningGroupIds, 'uuid[]')}))`,
    )
  }
  if (filters.gradeLevels?.length) {
    conditions.push(
      sql`exists (select 1 from material_grade_levels x where x.material_id = m.id and x.grade_level = any(${pgArray(filters.gradeLevels, 'int[]')}))`,
    )
  }
  if (filters.fileTypes?.length) {
    const lowered = filters.fileTypes.map((t) => t.toLowerCase().replace(/^\./, ''))
    conditions.push(
      sql`exists (
        select 1 from material_assets a join material_variants v on v.id = a.variant_id
        where v.material_id = m.id and a.file_name is not null
          and lower(split_part(a.file_name, '.', array_length(string_to_array(a.file_name, '.'), 1))) = any(${pgArray(lowered, 'text[]')})
      )`,
    )
  }
  if (filters.missingSolution) {
    conditions.push(
      sql`not exists (
        select 1 from material_relations r
        where r.from_material_id = m.id and r.relation_type in ('musterloesung', 'loesung')
      )`,
    )
  }

  return conditions
}

function whereClause(filters: MaterialFilters): SQL {
  const conditions = buildConditions(filters)
  if (conditions.length === 0) return sql`true`
  return sql.join(conditions, sql` and `)
}

function orderClause(sort: MaterialSort, ids?: string[]): SQL {
  switch (sort) {
    case 'titel':
      return sql`m.title asc`
    case 'datum_alt':
      return sql`m.created_at asc`
    case 'zuletzt_verwendet':
      return sql`m.last_used_at desc nulls last, m.updated_at desc`
    case 'bewertung':
      return sql`m.rating desc nulls last, m.updated_at desc`
    case 'verwendung':
      return sql`"usageCount" desc, m.updated_at desc`
    case 'relevanz':
      // Bei einer Volltextsuche gibt die Reihenfolge der IDs die Relevanz vor.
      if (ids?.length) return sql`array_position(${pgArray(ids, 'uuid[]')}, m.id)`
      return sql`m.updated_at desc`
    case 'datum_neu':
    default:
      return sql`m.updated_at desc`
  }
}

export interface ListMaterialsOptions {
  filters?: MaterialFilters
  sort?: MaterialSort
  page?: number
  pageSize?: number
}

export async function listMaterials(
  options: ListMaterialsOptions = {},
  db: Database = useDatabase(),
): Promise<{ items: MaterialSummary[]; total: number }> {
  const filters = options.filters ?? {}
  const page = Math.max(1, options.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 24))
  const where = whereClause(filters)

  const [countRow] = await db.execute<{ total: number }>(
    sql`select count(*)::int as total from materials m where ${where}`,
  )

  const rows = await queryRows<MaterialSummary>(db, 
    sql`select ${summarySelection} from materials m
      where ${where}
      order by ${orderClause(options.sort ?? 'datum_neu', filters.ids)}
      limit ${pageSize} offset ${(page - 1) * pageSize}`,
  )

  return { items: rows as unknown as MaterialSummary[], total: countRow?.total ?? 0 }
}

export async function getMaterialSummaries(
  ids: string[],
  db: Database = useDatabase(),
): Promise<MaterialSummary[]> {
  if (ids.length === 0) return []
  const rows = await queryRows<MaterialSummary>(db, 
    sql`select ${summarySelection} from materials m
      where m.id = any(${pgArray(ids, 'uuid[]')})
      order by array_position(${pgArray(ids, 'uuid[]')}, m.id)`,
  )
  return rows as unknown as MaterialSummary[]
}

export type MaterialVariantDetail = {
  id: string
  label: string
  variantKind: string
  differentiationLevel: string | null
  schoolYear: string | null
  version: string
  notes: string | null
  isDefault: boolean
  sortOrder: number
  assets: {
    id: string
    kind: 'datei' | 'link'
    role: 'haupt' | 'anhang'
    title: string | null
    fileName: string | null
    mimeType: string | null
    sizeBytes: number | null
    url: string | null
    pageCount: number | null
    extractionStatus: string
    extractionError: string | null
    hasText: boolean
    sortOrder: number
    createdAt: string
  }[]
}

export interface MaterialRelationDetail {
  id: string
  relationType: string
  note: string | null
  direction: 'ausgehend' | 'eingehend'
  material: {
    id: string
    title: string
    materialType: MaterialType
    origin: Origin
    aiMeta: AiMeta | null
  }
}

export interface MaterialUsageDetail {
  kind: 'unterrichtsstunde' | 'reihe'
  id: string
  title: string
  date: string | null
  status: string
  usage?: string | null
  seriesTitle?: string | null
}

export interface MaterialDetail extends MaterialSummary {
  content: string | null
  notes: string | null
  learningObjectives: string[]
  competencies: MaterialTaxonomyRef[]
  learningGroups: MaterialTaxonomyRef[]
  ownerName: string | null
  variants: MaterialVariantDetail[]
  relations: MaterialRelationDetail[]
  usages: MaterialUsageDetail[]
}

export async function getMaterialDetail(
  id: string,
  db: Database = useDatabase(),
): Promise<MaterialDetail | null> {
  const rows = await queryRows<MaterialDetail>(db, 
    sql`select ${summarySelection},
      m.content,
      m.notes,
      m.learning_objectives as "learningObjectives",
      (select u.name from users u where u.id = m.owner_id) as "ownerName",
      coalesce((
        select json_agg(json_build_object('id', c.id, 'name', c.name) order by c.name)
        from material_competencies mc join competencies c on c.id = mc.competency_id
        where mc.material_id = m.id
      ), '[]'::json) as "competencies",
      coalesce((
        select json_agg(json_build_object('id', g.id, 'name', g.name) order by g.name)
        from material_learning_groups mlg join learning_groups g on g.id = mlg.learning_group_id
        where mlg.material_id = m.id
      ), '[]'::json) as "learningGroups",
      coalesce((
        select json_agg(variant order by sort_order, created_at)
        from (
          select v.sort_order, v.created_at, json_build_object(
            'id', v.id, 'label', v.label, 'variantKind', v.variant_kind,
            'differentiationLevel', v.differentiation_level, 'schoolYear', v.school_year,
            'version', v.version, 'notes', v.notes, 'isDefault', v.is_default,
            'sortOrder', v.sort_order,
            'assets', coalesce((
              select json_agg(json_build_object(
                'id', a.id, 'kind', a.kind, 'role', a.role, 'title', a.title,
                'fileName', a.file_name, 'mimeType', a.mime_type, 'sizeBytes', a.size_bytes,
                'url', a.url, 'pageCount', a.page_count,
                'extractionStatus', a.extraction_status, 'extractionError', a.extraction_error,
                'hasText', (a.extracted_text is not null and length(a.extracted_text) > 0),
                'sortOrder', a.sort_order, 'createdAt', a.created_at
              ) order by a.role, a.sort_order, a.created_at)
              from material_assets a where a.variant_id = v.id
            ), '[]'::json)
          ) as variant
          from material_variants v where v.material_id = m.id
        ) variants
      ), '[]'::json) as "variants",
      coalesce((
        select json_agg(rel)
        from (
          select json_build_object(
            'id', r.id, 'relationType', r.relation_type, 'note', r.note,
            'direction', 'ausgehend',
            'material', json_build_object('id', o.id, 'title', o.title,
              'materialType', o.material_type, 'origin', o.origin, 'aiMeta', o.ai_meta)
          ) as rel
          from material_relations r join materials o on o.id = r.to_material_id
          where r.from_material_id = m.id
          union all
          select json_build_object(
            'id', r.id, 'relationType', r.relation_type, 'note', r.note,
            'direction', 'eingehend',
            'material', json_build_object('id', o.id, 'title', o.title,
              'materialType', o.material_type, 'origin', o.origin, 'aiMeta', o.ai_meta)
          ) as rel
          from material_relations r join materials o on o.id = r.from_material_id
          where r.to_material_id = m.id
        ) relations
      ), '[]'::json) as "relations",
      coalesce((
        select json_agg(u.usage order by u.sort_date desc nulls last)
        from (
          select l.date as sort_date, json_build_object(
            'kind', 'unterrichtsstunde', 'id', l.id, 'title', l.title,
            'date', l.date, 'status', l.status, 'usage', lm.usage,
            'seriesTitle', (select s2.title from series s2 where s2.id = l.series_id)
          ) as usage
          from lesson_materials lm join lessons l on l.id = lm.lesson_id
          where lm.material_id = m.id
          union all
          select s.start_date, json_build_object(
            'kind', 'reihe', 'id', s.id, 'title', s.title,
            'date', s.start_date, 'status', s.status,
            'usage', null, 'seriesTitle', null
          )
          from series_materials sm join series s on s.id = sm.series_id
          where sm.material_id = m.id
        ) u
      ), '[]'::json) as "usages"
      from materials m where m.id = ${id}::uuid`,
  )

  return (rows as unknown as MaterialDetail[])[0] ?? null
}

/** Kennzahlen für die Filterleiste: wie viele Treffer je Facette. */
export type MaterialFacets = {
  materialTypes: { value: string; count: number }[]
  subjects: { id: string; name: string; color: string | null; count: number }[]
  gradeLevels: { value: number; count: number }[]
  fileTypes: { value: string; count: number }[]
  tags: { id: string; name: string; count: number }[]
  origins: { value: string; count: number }[]
}

export async function getMaterialFacets(
  filters: MaterialFilters = {},
  db: Database = useDatabase(),
): Promise<MaterialFacets> {
  const where = whereClause(filters)

  const [row] = await queryRows<MaterialFacets>(db, 
    sql`with scope as (select m.id, m.material_type, m.origin from materials m where ${where})
      select
        coalesce((
          select json_agg(json_build_object('value', material_type, 'count', c) order by c desc)
          from (select material_type, count(*)::int c from scope group by material_type) t
        ), '[]'::json) as "materialTypes",
        coalesce((
          select json_agg(json_build_object('id', id, 'name', name, 'color', color, 'count', c) order by c desc)
          from (
            select s.id, s.name, s.color, count(*)::int c
            from scope join material_subjects ms on ms.material_id = scope.id
            join subjects s on s.id = ms.subject_id
            group by s.id, s.name, s.color
          ) t
        ), '[]'::json) as "subjects",
        coalesce((
          select json_agg(json_build_object('value', grade_level, 'count', c) order by grade_level)
          from (
            select mgl.grade_level, count(*)::int c
            from scope join material_grade_levels mgl on mgl.material_id = scope.id
            group by mgl.grade_level
          ) t
        ), '[]'::json) as "gradeLevels",
        coalesce((
          select json_agg(json_build_object('value', ext, 'count', c) order by c desc)
          from (
            select lower(split_part(a.file_name, '.', array_length(string_to_array(a.file_name, '.'), 1))) ext,
                   count(distinct scope.id)::int c
            from scope
            join material_variants v on v.material_id = scope.id
            join material_assets a on a.variant_id = v.id
            where a.file_name is not null
            group by ext
          ) t
        ), '[]'::json) as "fileTypes",
        coalesce((
          select json_agg(json_build_object('id', id, 'name', name, 'count', c) order by c desc)
          from (
            select tg.id, tg.name, count(*)::int c
            from scope join material_tags mt on mt.material_id = scope.id
            join tags tg on tg.id = mt.tag_id
            group by tg.id, tg.name
            order by c desc limit 40
          ) t
        ), '[]'::json) as "tags",
        coalesce((
          select json_agg(json_build_object('value', origin, 'count', c) order by c desc)
          from (select origin, count(*)::int c from scope group by origin) t
        ), '[]'::json) as "origins"`,
  )

  return (
    row ?? {
      materialTypes: [],
      subjects: [],
      gradeLevels: [],
      fileTypes: [],
      tags: [],
      origins: [],
    }
  )
}
