import { type SQL, sql } from 'drizzle-orm'
import { queryRows, useDatabase, type Database } from '../database/client'
import type { LessonStatus, MaterialUsage, SocialForm } from '#shared/types/domain'

export interface LessonFilters {
  subjectIds?: string[]
  learningGroupIds?: string[]
  topicIds?: string[]
  tagIds?: string[]
  competencyIds?: string[]
  seriesIds?: string[]
  statuses?: string[]
  dateFrom?: string
  dateTo?: string
  /** Nur Stunden ohne Reihenzuordnung. */
  withoutSeries?: boolean
  ownerId?: string
  ids?: string[]
}

export type LessonSort =
  | 'relevanz'
  | 'datum_neu'
  | 'datum_alt'
  | 'titel'
  | 'zuletzt_bearbeitet'
  | 'reihenfolge'

export type LessonSummary = {
  id: string
  title: string
  date: string | null
  scheduleNote: string | null
  periodFrom: number | null
  periodTo: number | null
  durationMinutes: number | null
  status: LessonStatus
  origin: string
  homework: string | null
  substituteTeacher: string | null
  subject: { id: string; name: string; color: string } | null
  learningGroup: { id: string; name: string } | null
  topic: { id: string; name: string } | null
  series: { id: string; title: string } | null
  positionInSeries: number | null
  tags: { id: string; name: string; color: string | null }[]
  phaseCount: number
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
  l.id, l.title, l.date, l.schedule_note as "scheduleNote",
  l.period_from as "periodFrom", l.period_to as "periodTo",
  l.duration_minutes as "durationMinutes",
  l.status, l.origin, l.homework, l.substitute_teacher as "substituteTeacher",
  l.position_in_series as "positionInSeries",
  l.created_at as "createdAt", l.updated_at as "updatedAt",
  (select json_build_object('id', s.id, 'name', s.name, 'color', s.color)
    from subjects s where s.id = l.subject_id) as "subject",
  (select json_build_object('id', g.id, 'name', g.name)
    from learning_groups g where g.id = l.learning_group_id) as "learningGroup",
  (select json_build_object('id', t.id, 'name', t.name)
    from topics t where t.id = l.topic_id) as "topic",
  (select json_build_object('id', r.id, 'title', r.title)
    from series r where r.id = l.series_id) as "series",
  coalesce((
    select json_agg(json_build_object('id', tg.id, 'name', tg.name, 'color', tg.color) order by tg.name)
    from lesson_tags lt join tags tg on tg.id = lt.tag_id where lt.lesson_id = l.id
  ), '[]'::json) as "tags",
  (select count(*)::int from lesson_phases p where p.lesson_id = l.id) as "phaseCount",
  (select count(*)::int from lesson_materials lm where lm.lesson_id = l.id) as "materialCount"
`

function buildConditions(filters: LessonFilters): SQL[] {
  const conditions: SQL[] = []

  if (filters.ownerId) conditions.push(sql`l.owner_id = ${filters.ownerId}`)
  if (filters.ids) {
    if (filters.ids.length === 0) return [sql`false`]
    conditions.push(sql`l.id = any(${pgArray(filters.ids, 'uuid[]')})`)
  }
  if (filters.statuses?.length) {
    conditions.push(sql`l.status = any(${pgArray(filters.statuses, 'lesson_status[]')})`)
  }
  if (filters.subjectIds?.length) {
    conditions.push(sql`l.subject_id = any(${pgArray(filters.subjectIds, 'uuid[]')})`)
  }
  if (filters.learningGroupIds?.length) {
    conditions.push(sql`l.learning_group_id = any(${pgArray(filters.learningGroupIds, 'uuid[]')})`)
  }
  if (filters.topicIds?.length) {
    conditions.push(sql`l.topic_id = any(${pgArray(filters.topicIds, 'uuid[]')})`)
  }
  if (filters.seriesIds?.length) {
    conditions.push(sql`l.series_id = any(${pgArray(filters.seriesIds, 'uuid[]')})`)
  }
  if (filters.withoutSeries) conditions.push(sql`l.series_id is null`)
  if (filters.dateFrom) conditions.push(sql`l.date >= ${filters.dateFrom}::date`)
  if (filters.dateTo) conditions.push(sql`l.date <= ${filters.dateTo}::date`)
  if (filters.tagIds?.length) {
    conditions.push(
      sql`exists (select 1 from lesson_tags x where x.lesson_id = l.id and x.tag_id = any(${pgArray(filters.tagIds, 'uuid[]')}))`,
    )
  }
  if (filters.competencyIds?.length) {
    conditions.push(
      sql`exists (select 1 from lesson_competencies x where x.lesson_id = l.id and x.competency_id = any(${pgArray(filters.competencyIds, 'uuid[]')}))`,
    )
  }

  return conditions
}

function whereClause(filters: LessonFilters): SQL {
  const conditions = buildConditions(filters)
  return conditions.length === 0 ? sql`true` : sql.join(conditions, sql` and `)
}

function orderClause(sort: LessonSort, ids?: string[]): SQL {
  switch (sort) {
    case 'titel':
      return sql`l.title asc`
    case 'datum_alt':
      return sql`l.date asc nulls last, l.created_at asc`
    case 'zuletzt_bearbeitet':
      return sql`l.updated_at desc`
    case 'reihenfolge':
      return sql`l.position_in_series asc nulls last, l.date asc nulls last`
    case 'relevanz':
      if (ids?.length) return sql`array_position(${pgArray(ids, 'uuid[]')}, l.id)`
      return sql`l.date desc nulls last, l.updated_at desc`
    case 'datum_neu':
    default:
      return sql`l.date desc nulls last, l.updated_at desc`
  }
}

export async function listLessons(
  options: { filters?: LessonFilters; sort?: LessonSort; page?: number; pageSize?: number } = {},
  db: Database = useDatabase(),
): Promise<{ items: LessonSummary[]; total: number }> {
  const filters = options.filters ?? {}
  const page = Math.max(1, options.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, options.pageSize ?? 25))
  const where = whereClause(filters)

  const [countRow] = await db.execute<{ total: number }>(
    sql`select count(*)::int as total from lessons l where ${where}`,
  )

  const rows = await db.execute(
    sql`select ${summarySelection} from lessons l
      where ${where}
      order by ${orderClause(options.sort ?? 'datum_neu', filters.ids)}
      limit ${pageSize} offset ${(page - 1) * pageSize}`,
  )

  return { items: rows as unknown as LessonSummary[], total: countRow?.total ?? 0 }
}

export type LessonPhaseDetail = {
  id: string
  name: string
  durationMinutes: number | null
  content: string | null
  teacherActivity: string | null
  studentActivity: string | null
  method: string | null
  socialForm: SocialForm | null
  notes: string | null
  sortOrder: number
  materials: {
    id: string
    materialId: string
    variantId: string | null
    title: string
    materialType: string
    variantLabel: string | null
    note: string | null
    sortOrder: number
  }[]
}

export interface LessonMaterialDetail {
  id: string
  materialId: string
  variantId: string | null
  title: string
  materialType: string
  origin: string
  variantLabel: string | null
  usage: MaterialUsage
  note: string | null
  sortOrder: number
  assetCount: number
  hasSolution: boolean
}

export interface LessonDetail extends LessonSummary {
  notes: string | null
  reflection: string | null
  methodSummary: string | null
  learningObjectives: string[]
  competencies: { id: string; name: string }[]
  ownerName: string | null
  phases: LessonPhaseDetail[]
  materials: LessonMaterialDetail[]
}

const detailSelection = sql`
  l.notes, l.reflection, l.method_summary as "methodSummary",
  l.learning_objectives as "learningObjectives",
  (select u.name from users u where u.id = l.owner_id) as "ownerName",
  coalesce((
    select json_agg(json_build_object('id', c.id, 'name', c.name) order by c.name)
    from lesson_competencies lc join competencies c on c.id = lc.competency_id
    where lc.lesson_id = l.id
  ), '[]'::json) as "competencies",
  coalesce((
    select json_agg(phase order by sort_order)
    from (
      select p.sort_order, json_build_object(
        'id', p.id, 'name', p.name, 'durationMinutes', p.duration_minutes,
        'content', p.content, 'teacherActivity', p.teacher_activity,
        'studentActivity', p.student_activity, 'method', p.method,
        'socialForm', p.social_form, 'notes', p.notes, 'sortOrder', p.sort_order,
        'materials', coalesce((
          select json_agg(json_build_object(
            'id', pm.id, 'materialId', pm.material_id, 'variantId', pm.variant_id,
            'title', mm.title, 'materialType', mm.material_type,
            'variantLabel', (select vv.label from material_variants vv where vv.id = pm.variant_id),
            'note', pm.note, 'sortOrder', pm.sort_order
          ) order by pm.sort_order)
          from lesson_phase_materials pm join materials mm on mm.id = pm.material_id
          where pm.phase_id = p.id
        ), '[]'::json)
      ) as phase
      from lesson_phases p where p.lesson_id = l.id
    ) phases
  ), '[]'::json) as "phases",
  coalesce((
    select json_agg(json_build_object(
      'id', lm.id, 'materialId', lm.material_id, 'variantId', lm.variant_id,
      'title', mm.title, 'materialType', mm.material_type, 'origin', mm.origin,
      'variantLabel', (select vv.label from material_variants vv where vv.id = lm.variant_id),
      'usage', lm.usage, 'note', lm.note, 'sortOrder', lm.sort_order,
      'assetCount', (
        select count(*)::int from material_assets a
        join material_variants v on v.id = a.variant_id where v.material_id = mm.id
      ),
      'hasSolution', exists(
        select 1 from material_relations r
        where r.from_material_id = mm.id and r.relation_type in ('musterloesung', 'loesung')
      )
    ) order by lm.sort_order)
    from lesson_materials lm join materials mm on mm.id = lm.material_id
    where lm.lesson_id = l.id
  ), '[]'::json) as "materials"
`

export async function getLessonDetail(
  id: string,
  db: Database = useDatabase(),
): Promise<LessonDetail | null> {
  const rows = await queryRows<LessonDetail>(db, 
    sql`select ${summarySelection}, ${detailSelection}
      from lessons l where l.id = ${id}::uuid`,
  )
  return (rows as unknown as LessonDetail[])[0] ?? null
}

export async function getLessonSummaries(
  ids: string[],
  db: Database = useDatabase(),
): Promise<LessonSummary[]> {
  if (ids.length === 0) return []
  const rows = await db.execute(
    sql`select ${summarySelection} from lessons l
      where l.id = any(${pgArray(ids, 'uuid[]')})
      order by array_position(${pgArray(ids, 'uuid[]')}, l.id)`,
  )
  return rows as unknown as LessonSummary[]
}

/** Anstehende Stunden für das Dashboard. */
export async function getUpcomingLessons(
  limit = 5,
  db: Database = useDatabase(),
): Promise<LessonSummary[]> {
  const rows = await db.execute(
    sql`select ${summarySelection} from lessons l
      where l.date >= current_date and l.status <> 'durchgefuehrt'
      order by l.date asc, l.period_from asc nulls last
      limit ${limit}`,
  )
  return rows as unknown as LessonSummary[]
}
