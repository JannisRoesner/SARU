import { sql } from 'drizzle-orm'
import { queryRows, useDatabase } from '../../database/client'
import { materialTypes, schoolForms, socialForms } from '#shared/utils/labels'
import { chunkText, type IndexDocument } from './indexer'

/**
 * Baut die indizierbaren Abschnitte einer Entität.
 * Abschnitt 0 enthält immer Titel und Metadaten, damit auch bei reiner
 * Metadatensuche ein Treffer entsteht. Weitere Abschnitte enthalten
 * Dokumenttexte aus den Anhängen.
 */

function joinMeta(parts: (string | null | undefined)[]): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' · ')
}

interface MaterialIndexRow {
  title: string
  description: string | null
  content: string | null
  notes: string | null
  materialType: string
  schoolForm: string | null
  source: string | null
  author: string | null
  pages: string | null
  origin: string
  learningObjectives: string[]
  subjects: string[]
  topics: string[]
  tags: string[]
  competencies: string[]
  groups: string[]
  gradeLevels: number[]
  assets: { label: string; text: string | null }[]
}

export async function buildMaterialDocuments(
  materialId: string,
): Promise<IndexDocument[] | null> {
  const rows = await queryRows<MaterialIndexRow>(useDatabase(), 
    sql`select
      m.title, m.description, m.content, m.notes,
      m.material_type as "materialType", m.school_form as "schoolForm",
      m.source, m.author, m.pages, m.origin,
      m.learning_objectives as "learningObjectives",
      coalesce((select array_agg(s.name order by s.name) from material_subjects ms
        join subjects s on s.id = ms.subject_id where ms.material_id = m.id), '{}') as "subjects",
      coalesce((select array_agg(t.name order by t.name) from material_topics mt
        join topics t on t.id = mt.topic_id where mt.material_id = m.id), '{}') as "topics",
      coalesce((select array_agg(tg.name order by tg.name) from material_tags mtg
        join tags tg on tg.id = mtg.tag_id where mtg.material_id = m.id), '{}') as "tags",
      coalesce((select array_agg(c.name order by c.name) from material_competencies mc
        join competencies c on c.id = mc.competency_id where mc.material_id = m.id), '{}') as "competencies",
      coalesce((select array_agg(g.name order by g.name) from material_learning_groups mlg
        join learning_groups g on g.id = mlg.learning_group_id where mlg.material_id = m.id), '{}') as "groups",
      coalesce((select array_agg(mgl.grade_level order by mgl.grade_level)
        from material_grade_levels mgl where mgl.material_id = m.id), '{}') as "gradeLevels",
      coalesce((
        select json_agg(json_build_object(
          'label', coalesce(a.title, a.file_name, a.url),
          'text', a.extracted_text
        ) order by v.sort_order, a.sort_order)
        from material_variants v join material_assets a on a.variant_id = v.id
        where v.material_id = m.id
      ), '[]'::json) as "assets"
      from materials m where m.id = ${materialId}::uuid`,
  )

  const row = (rows as unknown as MaterialIndexRow[])[0]
  if (!row) return null

  const metaText = joinMeta([
    materialTypes.label(row.materialType as never),
    row.subjects.join(', '),
    row.gradeLevels.length ? `Jahrgangsstufe ${row.gradeLevels.join(', ')}` : null,
    row.schoolForm ? schoolForms.label(row.schoolForm as never) : null,
    row.topics.join(', '),
    row.tags.join(', '),
    row.competencies.join(', '),
    row.groups.join(', '),
    row.author ? `Autor: ${row.author}` : null,
    row.source ? `Quelle: ${row.source}` : null,
    row.pages ? `Seiten: ${row.pages}` : null,
    row.learningObjectives.join('; '),
    row.origin === 'ki' ? 'KI-generiert' : null,
  ])

  const documents: IndexDocument[] = [
    {
      chunkIndex: 0,
      title: row.title,
      metaText,
      content: joinMeta([row.description, row.content?.slice(0, 4000), row.notes]),
    },
  ]

  let chunkIndex = 1
  for (const asset of row.assets ?? []) {
    if (!asset.text) continue
    for (const chunk of chunkText(asset.text)) {
      documents.push({
        chunkIndex: chunkIndex++,
        title: row.title,
        metaText,
        content: chunk,
        sourceLabel: asset.label,
      })
      if (chunkIndex > 60) break
    }
    if (chunkIndex > 60) break
  }

  // Langer Eigentext (z. B. KI-Musterlösung) ebenfalls in Abschnitte zerlegen.
  if (row.content && row.content.length > 4000) {
    for (const chunk of chunkText(row.content)) {
      if (chunkIndex > 60) break
      documents.push({
        chunkIndex: chunkIndex++,
        title: row.title,
        metaText,
        content: chunk,
        sourceLabel: 'Inhalt',
      })
    }
  }

  return documents
}

interface LessonIndexRow {
  title: string
  date: string | null
  scheduleNote: string | null
  homework: string | null
  notes: string | null
  reflection: string | null
  methodSummary: string | null
  status: string
  substituteTeacher: string | null
  learningObjectives: string[]
  subject: string | null
  group: string | null
  topic: string | null
  seriesTitle: string | null
  tags: string[]
  competencies: string[]
  phases: {
    name: string
    content: string | null
    teacherActivity: string | null
    studentActivity: string | null
    method: string | null
    socialForm: string | null
  }[]
  materialTitles: string[]
}

export async function buildLessonDocuments(lessonId: string): Promise<IndexDocument[] | null> {
  const rows = await queryRows<LessonIndexRow>(useDatabase(), 
    sql`select
      l.title, l.date, l.schedule_note as "scheduleNote", l.homework, l.notes, l.reflection,
      l.method_summary as "methodSummary", l.status, l.substitute_teacher as "substituteTeacher",
      l.learning_objectives as "learningObjectives",
      (select s.name from subjects s where s.id = l.subject_id) as "subject",
      (select g.name from learning_groups g where g.id = l.learning_group_id) as "group",
      (select t.name from topics t where t.id = l.topic_id) as "topic",
      (select r.title from series r where r.id = l.series_id) as "seriesTitle",
      coalesce((select array_agg(tg.name order by tg.name) from lesson_tags lt
        join tags tg on tg.id = lt.tag_id where lt.lesson_id = l.id), '{}') as "tags",
      coalesce((select array_agg(c.name order by c.name) from lesson_competencies lc
        join competencies c on c.id = lc.competency_id where lc.lesson_id = l.id), '{}') as "competencies",
      coalesce((
        select json_agg(json_build_object(
          'name', p.name, 'content', p.content,
          'teacherActivity', p.teacher_activity, 'studentActivity', p.student_activity,
          'method', p.method, 'socialForm', p.social_form
        ) order by p.sort_order)
        from lesson_phases p where p.lesson_id = l.id
      ), '[]'::json) as "phases",
      coalesce((select array_agg(distinct mt.title) from lesson_materials lm
        join materials mt on mt.id = lm.material_id where lm.lesson_id = l.id), '{}') as "materialTitles"
      from lessons l where l.id = ${lessonId}::uuid`,
  )

  const row = (rows as unknown as LessonIndexRow[])[0]
  if (!row) return null

  const metaText = joinMeta([
    'Unterrichtsstunde',
    row.subject,
    row.group,
    row.topic,
    row.seriesTitle ? `Reihe: ${row.seriesTitle}` : null,
    row.date ?? row.scheduleNote,
    row.tags.join(', '),
    row.competencies.join(', '),
    row.learningObjectives.join('; '),
    row.materialTitles.join(', '),
    row.substituteTeacher ? `Vertretung: ${row.substituteTeacher}` : null,
  ])

  const phaseText = (row.phases ?? [])
    .map((phase) =>
      joinMeta([
        phase.name,
        phase.method,
        phase.socialForm ? socialForms.label(phase.socialForm as never) : null,
        phase.content,
        phase.teacherActivity ? `Lehrkraft: ${phase.teacherActivity}` : null,
        phase.studentActivity ? `Lernende: ${phase.studentActivity}` : null,
      ]),
    )
    .join('\n\n')

  const body = [
    row.methodSummary,
    phaseText,
    row.homework ? `Hausaufgaben: ${row.homework}` : null,
    row.notes,
    row.reflection ? `Reflexion: ${row.reflection}` : null,
  ]
    .filter(Boolean)
    .join('\n\n')

  const chunks = chunkText(body)
  if (chunks.length === 0) {
    return [{ chunkIndex: 0, title: row.title, metaText, content: '' }]
  }

  return chunks.map((content, index) => ({
    chunkIndex: index,
    title: row.title,
    metaText,
    content,
  }))
}

interface SeriesIndexRow {
  title: string
  description: string | null
  notes: string | null
  status: string
  schoolYear: string | null
  startDate: string | null
  endDate: string | null
  learningObjectives: string[]
  subject: string | null
  group: string | null
  topic: string | null
  tags: string[]
  competencies: string[]
  lessonTitles: string[]
}

export async function buildSeriesDocuments(seriesId: string): Promise<IndexDocument[] | null> {
  const rows = await queryRows<SeriesIndexRow>(useDatabase(), 
    sql`select
      r.title, r.description, r.notes, r.status, r.school_year as "schoolYear",
      r.start_date as "startDate", r.end_date as "endDate",
      r.learning_objectives as "learningObjectives",
      (select s.name from subjects s where s.id = r.subject_id) as "subject",
      (select g.name from learning_groups g where g.id = r.learning_group_id) as "group",
      (select t.name from topics t where t.id = r.topic_id) as "topic",
      coalesce((select array_agg(tg.name order by tg.name) from series_tags st
        join tags tg on tg.id = st.tag_id where st.series_id = r.id), '{}') as "tags",
      coalesce((select array_agg(c.name order by c.name) from series_competencies sc
        join competencies c on c.id = sc.competency_id where sc.series_id = r.id), '{}') as "competencies",
      coalesce((select array_agg(l.title order by l.position_in_series, l.date)
        from lessons l where l.series_id = r.id), '{}') as "lessonTitles"
      from series r where r.id = ${seriesId}::uuid`,
  )

  const row = (rows as unknown as SeriesIndexRow[])[0]
  if (!row) return null

  const metaText = joinMeta([
    'Unterrichtsreihe',
    row.subject,
    row.group,
    row.topic,
    row.schoolYear,
    row.startDate && row.endDate ? `${row.startDate} bis ${row.endDate}` : row.startDate,
    row.tags.join(', '),
    row.competencies.join(', '),
    row.learningObjectives.join('; '),
  ])

  const body = [row.description, row.notes, row.lessonTitles.join('\n')]
    .filter(Boolean)
    .join('\n\n')

  const chunks = chunkText(body)
  if (chunks.length === 0) {
    return [{ chunkIndex: 0, title: row.title, metaText, content: '' }]
  }

  return chunks.map((content, index) => ({
    chunkIndex: index,
    title: row.title,
    metaText,
    content,
  }))
}
