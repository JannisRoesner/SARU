import { type SQL, sql } from 'drizzle-orm'
import { queryRows, useDatabase, type Database } from '../database/client'
import type { SeriesStatus } from '#shared/types/domain'
import type { LessonSummary } from './lesson.repository'

export interface SeriesFilters {
  subjectIds?: string[]
  learningGroupIds?: string[]
  topicIds?: string[]
  tagIds?: string[]
  statuses?: string[]
  schoolYears?: string[]
  dateFrom?: string
  dateTo?: string
  ownerId?: string
  ids?: string[]
}

export type SeriesSort = 'relevanz' | 'datum_neu' | 'datum_alt' | 'titel' | 'fortschritt'

export type SeriesProgress = {
  total: number
  durchgefuehrt: number
  geplant: number
  entwurf: number
  /** Anteil durchgeführter Stunden in Prozent. */
  percent: number
}

export type SeriesSummary = {
  id: string
  title: string
  description: string | null
  status: SeriesStatus
  startDate: string | null
  endDate: string | null
  schoolYear: string | null
  subject: { id: string; name: string; color: string } | null
  learningGroup: { id: string; name: string } | null
  topic: { id: string; name: string } | null
  tags: { id: string; name: string; color: string | null }[]
  progress: SeriesProgress
  materialCount: number
  createdAt: string
  updatedAt: string
}

function pgArray(values: readonly (string | number)[], cast: string): SQL {
  if (values.length === 0) return sql`array[]::${sql.raw(cast)}`
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::${sql.raw(cast)}`
}

const summarySelection = sql`
  r.id, r.title, r.description, r.status,
  r.start_date as "startDate", r.end_date as "endDate", r.school_year as "schoolYear",
  r.created_at as "createdAt", r.updated_at as "updatedAt",
  (select json_build_object('id', s.id, 'name', s.name, 'color', s.color)
    from subjects s where s.id = r.subject_id) as "subject",
  (select json_build_object('id', g.id, 'name', g.name)
    from learning_groups g where g.id = r.learning_group_id) as "learningGroup",
  (select json_build_object('id', t.id, 'name', t.name)
    from topics t where t.id = r.topic_id) as "topic",
  coalesce((
    select json_agg(json_build_object('id', tg.id, 'name', tg.name, 'color', tg.color) order by tg.name)
    from series_tags st join tags tg on tg.id = st.tag_id where st.series_id = r.id
  ), '[]'::json) as "tags",
  (
    select json_build_object(
      'total', count(*)::int,
      'durchgefuehrt', count(*) filter (where l.status = 'durchgefuehrt')::int,
      'geplant', count(*) filter (where l.status = 'geplant')::int,
      'entwurf', count(*) filter (where l.status = 'entwurf')::int,
      'percent', case when count(*) = 0 then 0
        else round(100.0 * count(*) filter (where l.status = 'durchgefuehrt') / count(*))::int end
    )
    from lessons l where l.series_id = r.id
  ) as "progress",
  (select count(*)::int from series_materials sm where sm.series_id = r.id) as "materialCount"
`

function whereClause(filters: SeriesFilters): SQL {
  const conditions: SQL[] = []

  if (filters.ownerId) conditions.push(sql`r.owner_id = ${filters.ownerId}`)
  if (filters.ids) {
    if (filters.ids.length === 0) return sql`false`
    conditions.push(sql`r.id = any(${pgArray(filters.ids, 'uuid[]')})`)
  }
  if (filters.statuses?.length) {
    conditions.push(sql`r.status = any(${pgArray(filters.statuses, 'series_status[]')})`)
  }
  if (filters.subjectIds?.length) {
    conditions.push(sql`r.subject_id = any(${pgArray(filters.subjectIds, 'uuid[]')})`)
  }
  if (filters.learningGroupIds?.length) {
    conditions.push(sql`r.learning_group_id = any(${pgArray(filters.learningGroupIds, 'uuid[]')})`)
  }
  if (filters.topicIds?.length) {
    conditions.push(sql`r.topic_id = any(${pgArray(filters.topicIds, 'uuid[]')})`)
  }
  if (filters.schoolYears?.length) {
    conditions.push(sql`r.school_year = any(${pgArray(filters.schoolYears, 'text[]')})`)
  }
  if (filters.dateFrom) conditions.push(sql`coalesce(r.end_date, r.start_date) >= ${filters.dateFrom}::date`)
  if (filters.dateTo) conditions.push(sql`r.start_date <= ${filters.dateTo}::date`)
  if (filters.tagIds?.length) {
    conditions.push(
      sql`exists (select 1 from series_tags x where x.series_id = r.id and x.tag_id = any(${pgArray(filters.tagIds, 'uuid[]')}))`,
    )
  }

  return conditions.length === 0 ? sql`true` : sql.join(conditions, sql` and `)
}

function orderClause(sort: SeriesSort, ids?: string[]): SQL {
  switch (sort) {
    case 'titel':
      return sql`r.title asc`
    case 'datum_alt':
      return sql`r.start_date asc nulls last`
    case 'fortschritt':
      return sql`("progress"->>'percent')::int desc`
    case 'relevanz':
      if (ids?.length) return sql`array_position(${pgArray(ids, 'uuid[]')}, r.id)`
      return sql`r.updated_at desc`
    case 'datum_neu':
    default:
      return sql`r.start_date desc nulls last, r.updated_at desc`
  }
}

export async function listSeries(
  options: { filters?: SeriesFilters; sort?: SeriesSort; page?: number; pageSize?: number } = {},
  db: Database = useDatabase(),
): Promise<{ items: SeriesSummary[]; total: number }> {
  const filters = options.filters ?? {}
  const page = Math.max(1, options.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 24))
  const where = whereClause(filters)

  const [countRow] = await db.execute<{ total: number }>(
    sql`select count(*)::int as total from series r where ${where}`,
  )

  const rows = await queryRows<SeriesSummary>(db, 
    sql`select * from (select ${summarySelection} from series r where ${where}) s
      order by ${sql.raw(orderClauseAlias(options.sort ?? 'datum_neu'))}
      limit ${pageSize} offset ${(page - 1) * pageSize}`,
  )

  return { items: rows as unknown as SeriesSummary[], total: countRow?.total ?? 0 }
}

/** Sortierung auf der äußeren Auswahl, damit auch berechnete Spalten nutzbar sind. */
function orderClauseAlias(sort: SeriesSort): string {
  switch (sort) {
    case 'titel':
      return 's.title asc'
    case 'datum_alt':
      return 's."startDate" asc nulls last'
    case 'fortschritt':
      return `(s."progress"->>'percent')::int desc`
    case 'datum_neu':
    default:
      return 's."startDate" desc nulls last, s."updatedAt" desc'
  }
}

export interface SeriesMaterialDetail {
  id: string
  materialId: string
  variantId: string | null
  title: string
  materialType: string
  variantLabel: string | null
  note: string | null
  sortOrder: number
}

export interface SeriesDetail extends SeriesSummary {
  notes: string | null
  learningObjectives: string[]
  competencies: { id: string; name: string }[]
  ownerName: string | null
  lessons: LessonSummary[]
  materials: SeriesMaterialDetail[]
}

export async function getSeriesDetail(
  id: string,
  db: Database = useDatabase(),
): Promise<SeriesDetail | null> {
  const rows = await queryRows<SeriesDetail>(db, 
    sql`select ${summarySelection},
      r.notes, r.learning_objectives as "learningObjectives",
      (select u.name from users u where u.id = r.owner_id) as "ownerName",
      coalesce((
        select json_agg(json_build_object('id', c.id, 'name', c.name) order by c.name)
        from series_competencies sc join competencies c on c.id = sc.competency_id
        where sc.series_id = r.id
      ), '[]'::json) as "competencies",
      coalesce((
        select json_agg(lesson order by position, date)
        from (
          select l.position_in_series as position, l.date, json_build_object(
            'id', l.id, 'title', l.title, 'date', l.date,
            'scheduleNote', l.schedule_note,
            'periodFrom', l.period_from, 'periodTo', l.period_to,
            'durationMinutes', l.duration_minutes,
            'status', l.status, 'origin', l.origin, 'homework', l.homework,
            'substituteTeacher', l.substitute_teacher,
            'positionInSeries', l.position_in_series,
            'createdAt', l.created_at, 'updatedAt', l.updated_at,
            'subject', (select json_build_object('id', s2.id, 'name', s2.name, 'color', s2.color)
              from subjects s2 where s2.id = l.subject_id),
            'learningGroup', (select json_build_object('id', g2.id, 'name', g2.name)
              from learning_groups g2 where g2.id = l.learning_group_id),
            'topic', (select json_build_object('id', t2.id, 'name', t2.name)
              from topics t2 where t2.id = l.topic_id),
            'series', json_build_object('id', r.id, 'title', r.title),
            'tags', coalesce((
              select json_agg(json_build_object('id', tg.id, 'name', tg.name, 'color', tg.color) order by tg.name)
              from lesson_tags lt join tags tg on tg.id = lt.tag_id where lt.lesson_id = l.id
            ), '[]'::json),
            'phaseCount', (select count(*)::int from lesson_phases p where p.lesson_id = l.id),
            'materialCount', (select count(*)::int from lesson_materials lm where lm.lesson_id = l.id)
          ) as lesson
          from lessons l where l.series_id = r.id
        ) lessons
      ), '[]'::json) as "lessons",
      coalesce((
        select json_agg(json_build_object(
          'id', sm.id, 'materialId', sm.material_id, 'variantId', sm.variant_id,
          'title', mm.title, 'materialType', mm.material_type,
          'variantLabel', (select vv.label from material_variants vv where vv.id = sm.variant_id),
          'note', sm.note, 'sortOrder', sm.sort_order
        ) order by sm.sort_order)
        from series_materials sm join materials mm on mm.id = sm.material_id
        where sm.series_id = r.id
      ), '[]'::json) as "materials"
      from series r where r.id = ${id}::uuid`,
  )

  return (rows as unknown as SeriesDetail[])[0] ?? null
}

export async function getSeriesSummaries(
  ids: string[],
  db: Database = useDatabase(),
): Promise<SeriesSummary[]> {
  if (ids.length === 0) return []
  const rows = await queryRows<SeriesSummary>(db, 
    sql`select ${summarySelection} from series r
      where r.id = any(${pgArray(ids, 'uuid[]')})
      order by array_position(${pgArray(ids, 'uuid[]')}, r.id)`,
  )
  return rows as unknown as SeriesSummary[]
}

export async function getActiveSeries(
  limit = 5,
  db: Database = useDatabase(),
): Promise<SeriesSummary[]> {
  const rows = await queryRows<SeriesSummary>(db, 
    sql`select ${summarySelection} from series r
      where r.status = 'aktiv'
      order by r.updated_at desc limit ${limit}`,
  )
  return rows as unknown as SeriesSummary[]
}
