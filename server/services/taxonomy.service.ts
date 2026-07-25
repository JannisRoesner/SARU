import { and, asc, eq, ilike, isNull, sql } from 'drizzle-orm'
import { useDatabase, type Database } from '../database/client'
import {
  competencies,
  learningGroups,
  materialTags,
  materialTopics,
  subjects,
  tags,
  topics,
} from '../database/schema'
import { notFound } from '../utils/errors'

/** Farbpalette für neu angelegte Fächer, damit die Oberfläche unterscheidbar bleibt. */
const SUBJECT_COLORS = [
  '#2563eb',
  '#16a34a',
  '#dc2626',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
  '#4f46e5',
  '#ea580c',
]

export async function listSubjects(db: Database = useDatabase()) {
  return db.select().from(subjects).orderBy(asc(subjects.sortOrder), asc(subjects.name))
}

/** Findet ein Fach namensunabhängig von Groß-/Kleinschreibung oder legt es an. */
export async function getOrCreateSubject(
  name: string,
  db: Database = useDatabase(),
): Promise<string> {
  const trimmed = name.trim()
  if (!trimmed) throw notFound('Das Fach')

  const existing = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(ilike(subjects.name, trimmed))
    .limit(1)
  if (existing[0]) return existing[0].id

  const [row] = await db.select({ value: sql<number>`count(*)::int` }).from(subjects)
  const count = row?.value ?? 0
  const [created] = await db
    .insert(subjects)
    .values({
      name: trimmed,
      color: SUBJECT_COLORS[count % SUBJECT_COLORS.length]!,
      sortOrder: count,
    })
    .onConflictDoNothing()
    .returning({ id: subjects.id })

  if (created) return created.id

  // Bei paralleler Anlage: erneut lesen.
  const retry = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(ilike(subjects.name, trimmed))
    .limit(1)
  return retry[0]!.id
}

export async function listLearningGroups(db: Database = useDatabase()) {
  return db
    .select()
    .from(learningGroups)
    .orderBy(asc(learningGroups.schoolYear), asc(learningGroups.name))
}

export interface LearningGroupInput {
  name: string
  subjectId?: string | null
  gradeLevel?: number | null
  schoolYear?: string | null
  schoolForm?: string | null
}

export async function getOrCreateLearningGroup(
  input: LearningGroupInput,
  db: Database = useDatabase(),
): Promise<string> {
  const name = input.name.trim()
  const schoolYear = input.schoolYear?.trim() ?? null

  const existing = await db
    .select({ id: learningGroups.id })
    .from(learningGroups)
    .where(
      and(
        ilike(learningGroups.name, name),
        schoolYear === null
          ? isNull(learningGroups.schoolYear)
          : eq(learningGroups.schoolYear, schoolYear),
      ),
    )
    .limit(1)
  if (existing[0]) return existing[0].id

  const [created] = await db
    .insert(learningGroups)
    .values({
      name,
      schoolYear,
      subjectId: input.subjectId ?? null,
      gradeLevel: input.gradeLevel ?? null,
      schoolForm: (input.schoolForm as never) ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: learningGroups.id })

  if (created) return created.id

  const retry = await db
    .select({ id: learningGroups.id })
    .from(learningGroups)
    .where(
      and(
        ilike(learningGroups.name, name),
        schoolYear === null
          ? isNull(learningGroups.schoolYear)
          : eq(learningGroups.schoolYear, schoolYear),
      ),
    )
    .limit(1)
  return retry[0]!.id
}

export async function listTopics(db: Database = useDatabase()) {
  return db.select().from(topics).orderBy(asc(topics.name))
}

export async function getOrCreateTopic(
  name: string,
  options: { parentId?: string | null; subjectId?: string | null } = {},
  db: Database = useDatabase(),
): Promise<string> {
  const trimmed = name.trim()
  if (!trimmed) throw notFound('Das Thema')
  const parentId = options.parentId ?? null

  const existing = await db
    .select({ id: topics.id })
    .from(topics)
    .where(
      and(
        ilike(topics.name, trimmed),
        parentId === null ? isNull(topics.parentId) : eq(topics.parentId, parentId),
      ),
    )
    .limit(1)
  if (existing[0]) return existing[0].id

  const [created] = await db
    .insert(topics)
    .values({ name: trimmed, parentId, subjectId: options.subjectId ?? null })
    .onConflictDoNothing()
    .returning({ id: topics.id })

  if (created) return created.id

  const retry = await db
    .select({ id: topics.id })
    .from(topics)
    .where(
      and(
        ilike(topics.name, trimmed),
        parentId === null ? isNull(topics.parentId) : eq(topics.parentId, parentId),
      ),
    )
    .limit(1)
  return retry[0]!.id
}

export async function listTags(db: Database = useDatabase()) {
  return db.select().from(tags).orderBy(asc(tags.name))
}

/** Löst eine Liste von Schlagwortnamen in IDs auf und legt fehlende an. */
export async function resolveTagIds(
  names: string[],
  db: Database = useDatabase(),
): Promise<string[]> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  if (unique.length === 0) return []

  const ids: string[] = []
  for (const name of unique) {
    const existing = await db
      .select({ id: tags.id })
      .from(tags)
      .where(ilike(tags.name, name))
      .limit(1)

    if (existing[0]) {
      ids.push(existing[0].id)
      continue
    }

    const [created] = await db
      .insert(tags)
      .values({ name })
      .onConflictDoNothing()
      .returning({ id: tags.id })

    if (created) {
      ids.push(created.id)
    } else {
      const retry = await db.select({ id: tags.id }).from(tags).where(ilike(tags.name, name)).limit(1)
      if (retry[0]) ids.push(retry[0].id)
    }
  }
  return ids
}

export async function listCompetencies(db: Database = useDatabase()) {
  return db.select().from(competencies).orderBy(asc(competencies.area), asc(competencies.name))
}

export async function resolveCompetencyIds(
  names: string[],
  subjectId: string | null,
  db: Database = useDatabase(),
): Promise<string[]> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  const ids: string[] = []

  for (const name of unique) {
    const existing = await db
      .select({ id: competencies.id })
      .from(competencies)
      .where(ilike(competencies.name, name))
      .limit(1)

    if (existing[0]) {
      ids.push(existing[0].id)
      continue
    }

    const [created] = await db
      .insert(competencies)
      .values({ name, subjectId })
      .onConflictDoNothing()
      .returning({ id: competencies.id })

    if (created) ids.push(created.id)
  }
  return ids
}

/** Entfernt Schlagwörter und Themen, die an keinem Datensatz mehr hängen. */
export async function pruneOrphanTaxonomy(db: Database = useDatabase()): Promise<{
  tags: number
  topics: number
}> {
  const removedTags = await db
    .delete(tags)
    .where(
      sql`not exists (select 1 from ${materialTags} where ${materialTags.tagId} = ${tags.id})
        and not exists (select 1 from lesson_tags where lesson_tags.tag_id = ${tags.id})
        and not exists (select 1 from series_tags where series_tags.tag_id = ${tags.id})`,
    )
    .returning({ id: tags.id })

  const removedTopics = await db
    .delete(topics)
    .where(
      sql`not exists (select 1 from ${materialTopics} where ${materialTopics.topicId} = ${topics.id})
        and not exists (select 1 from lessons where lessons.topic_id = ${topics.id})
        and not exists (select 1 from series where series.topic_id = ${topics.id})
        and not exists (select 1 from topics child where child.parent_id = ${topics.id})`,
    )
    .returning({ id: topics.id })

  return { tags: removedTags.length, topics: removedTopics.length }
}
