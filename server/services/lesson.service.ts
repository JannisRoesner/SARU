import { and, eq, max, sql } from 'drizzle-orm'
import { useDatabase, type Database } from '../database/client'
import {
  lessonCompetencies,
  lessonMaterials,
  lessonPhaseMaterials,
  lessonPhases,
  lessonTags,
  lessons,
} from '../database/schema'
import { invalidInput, notFound } from '../utils/errors'
import { createLogger } from '../utils/logger'
import { sanitizeText } from '../utils/validation'
import { getLessonDetail, type LessonDetail } from '../repositories/lesson.repository'
import { queueReindex, removeFromIndex } from './search/indexer'
import { markMaterialUsed } from './material.service'
import { resolveCompetencyIds, resolveTagIds } from './taxonomy.service'

const log = createLogger('lessons')

export interface PhaseInput {
  id?: string
  name: string
  durationMinutes?: number | null
  content?: string | null
  teacherActivity?: string | null
  studentActivity?: string | null
  method?: string | null
  socialForm?: string | null
  notes?: string | null
  materialIds?: { materialId: string; variantId?: string | null; note?: string | null }[]
}

export interface LessonInput {
  title: string
  date?: string | null
  scheduleNote?: string | null
  periodFrom?: number | null
  periodTo?: number | null
  durationMinutes?: number | null
  subjectId?: string | null
  learningGroupId?: string | null
  topicId?: string | null
  seriesId?: string | null
  positionInSeries?: number | null
  learningObjectives?: string[]
  methodSummary?: string | null
  homework?: string | null
  notes?: string | null
  reflection?: string | null
  substituteTeacher?: string | null
  status?: string
  origin?: 'manuell' | 'ki' | 'import'
  tagNames?: string[]
  competencyIds?: string[]
  competencyNames?: string[]
}

function lessonColumns(input: Partial<LessonInput>) {
  const patch: Record<string, unknown> = {}
  if (input.title !== undefined) patch.title = input.title.trim()
  if (input.date !== undefined) patch.date = input.date || null
  if (input.scheduleNote !== undefined) patch.scheduleNote = sanitizeText(input.scheduleNote, 500)
  if (input.periodFrom !== undefined) patch.periodFrom = input.periodFrom
  if (input.periodTo !== undefined) patch.periodTo = input.periodTo
  if (input.durationMinutes !== undefined) patch.durationMinutes = input.durationMinutes
  if (input.subjectId !== undefined) patch.subjectId = input.subjectId
  if (input.learningGroupId !== undefined) patch.learningGroupId = input.learningGroupId
  if (input.topicId !== undefined) patch.topicId = input.topicId
  if (input.seriesId !== undefined) patch.seriesId = input.seriesId
  if (input.positionInSeries !== undefined) patch.positionInSeries = input.positionInSeries
  if (input.methodSummary !== undefined) patch.methodSummary = sanitizeText(input.methodSummary)
  if (input.homework !== undefined) patch.homework = sanitizeText(input.homework)
  if (input.notes !== undefined) patch.notes = sanitizeText(input.notes)
  if (input.reflection !== undefined) patch.reflection = sanitizeText(input.reflection)
  if (input.substituteTeacher !== undefined) {
    patch.substituteTeacher = sanitizeText(input.substituteTeacher, 200)
  }
  if (input.status !== undefined) patch.status = input.status
  if (input.origin !== undefined) patch.origin = input.origin
  if (input.learningObjectives !== undefined) {
    patch.learningObjectives = input.learningObjectives.map((o) => o.trim()).filter(Boolean).slice(0, 50)
  }
  return patch
}

async function applyLessonTaxonomy(
  db: Database,
  lessonId: string,
  input: Partial<LessonInput>,
): Promise<void> {
  if (input.tagNames !== undefined) {
    const tagIds = await resolveTagIds(input.tagNames, db)
    await db.delete(lessonTags).where(eq(lessonTags.lessonId, lessonId))
    if (tagIds.length) {
      await db.insert(lessonTags).values(tagIds.map((tagId) => ({ lessonId, tagId }))).onConflictDoNothing()
    }
  }

  if (input.competencyIds !== undefined || input.competencyNames !== undefined) {
    const ids = [...(input.competencyIds ?? [])]
    if (input.competencyNames?.length) {
      const [lesson] = await db
        .select({ subjectId: lessons.subjectId })
        .from(lessons)
        .where(eq(lessons.id, lessonId))
        .limit(1)
      ids.push(...(await resolveCompetencyIds(input.competencyNames, lesson?.subjectId ?? null, db)))
    }
    await db.delete(lessonCompetencies).where(eq(lessonCompetencies.lessonId, lessonId))
    const unique = [...new Set(ids)]
    if (unique.length) {
      await db
        .insert(lessonCompetencies)
        .values(unique.map((competencyId) => ({ lessonId, competencyId })))
        .onConflictDoNothing()
    }
  }
}

export async function createLesson(
  input: LessonInput,
  ownerId: string | null,
  db: Database = useDatabase(),
): Promise<string> {
  if (!input.title?.trim()) throw invalidInput('Bitte einen Titel für die Unterrichtsstunde angeben.')

  // Neue Stunden einer Reihe werden hinten angehängt.
  let position = input.positionInSeries ?? null
  if (input.seriesId && position === null) {
    const [{ value } = { value: null }] = await db
      .select({ value: max(lessons.positionInSeries) })
      .from(lessons)
      .where(eq(lessons.seriesId, input.seriesId))
    position = (value ?? -1) + 1
  }

  const [created] = await db
    .insert(lessons)
    .values({
      ...lessonColumns(input),
      title: input.title.trim(),
      positionInSeries: position,
      ownerId,
    } as never)
    .returning({ id: lessons.id })

  const lessonId = created!.id
  await applyLessonTaxonomy(db, lessonId, input)

  queueReindex('unterrichtsstunde', lessonId)
  if (input.seriesId) queueReindex('reihe', input.seriesId)
  log.info('Unterrichtsstunde angelegt', { lessonId, title: input.title })
  return lessonId
}

export async function updateLesson(
  id: string,
  input: Partial<LessonInput>,
  db: Database = useDatabase(),
): Promise<void> {
  const [existing] = await db
    .select({ seriesId: lessons.seriesId })
    .from(lessons)
    .where(eq(lessons.id, id))
    .limit(1)
  if (!existing) throw notFound('Die Unterrichtsstunde')

  const patch = lessonColumns(input)
  if (Object.keys(patch).length > 0) {
    await db
      .update(lessons)
      .set({ ...patch, updatedAt: new Date() } as never)
      .where(eq(lessons.id, id))
  }
  await applyLessonTaxonomy(db, id, input)

  queueReindex('unterrichtsstunde', id)
  if (existing.seriesId) queueReindex('reihe', existing.seriesId)
  if (input.seriesId && input.seriesId !== existing.seriesId) queueReindex('reihe', input.seriesId)
}

export async function deleteLesson(id: string, db: Database = useDatabase()): Promise<void> {
  const removed = await db
    .delete(lessons)
    .where(eq(lessons.id, id))
    .returning({ id: lessons.id, seriesId: lessons.seriesId })
  if (!removed[0]) throw notFound('Die Unterrichtsstunde')

  await removeFromIndex('unterrichtsstunde', id)
  if (removed[0].seriesId) queueReindex('reihe', removed[0].seriesId)
}

/** Kopiert eine Stunde samt Phasen und Materialzuordnungen. */
export async function duplicateLesson(
  id: string,
  ownerId: string | null,
  options: { seriesId?: string | null; title?: string } = {},
  db: Database = useDatabase(),
): Promise<string> {
  const source = await getLessonDetail(id, db)
  if (!source) throw notFound('Die Unterrichtsstunde')

  const targetSeriesId = options.seriesId !== undefined ? options.seriesId : (source.series?.id ?? null)

  let position: number | null = null
  if (targetSeriesId) {
    const [{ value } = { value: null }] = await db
      .select({ value: max(lessons.positionInSeries) })
      .from(lessons)
      .where(eq(lessons.seriesId, targetSeriesId))
    position = (value ?? -1) + 1
  }

  const [created] = await db
    .insert(lessons)
    .values({
      title: options.title ?? `${source.title} (Kopie)`,
      // Das Datum wird bewusst nicht übernommen – eine Kopie ist neu zu planen.
      date: null,
      scheduleNote: source.scheduleNote,
      periodFrom: source.periodFrom,
      periodTo: source.periodTo,
      durationMinutes: source.durationMinutes,
      subjectId: source.subject?.id ?? null,
      learningGroupId: source.learningGroup?.id ?? null,
      topicId: source.topic?.id ?? null,
      seriesId: targetSeriesId,
      positionInSeries: position,
      learningObjectives: source.learningObjectives,
      methodSummary: source.methodSummary,
      homework: source.homework,
      notes: source.notes,
      // Reflexion gehört zur konkreten Durchführung und wird nicht kopiert.
      reflection: null,
      status: 'entwurf',
      ownerId,
    } as never)
    .returning({ id: lessons.id })

  const newId = created!.id

  await applyLessonTaxonomy(db, newId, {
    tagNames: source.tags.map((t) => t.name),
    competencyIds: source.competencies.map((c) => c.id),
  })

  for (const phase of source.phases) {
    const [newPhase] = await db
      .insert(lessonPhases)
      .values({
        lessonId: newId,
        name: phase.name,
        durationMinutes: phase.durationMinutes,
        content: phase.content,
        teacherActivity: phase.teacherActivity,
        studentActivity: phase.studentActivity,
        method: phase.method,
        socialForm: phase.socialForm as never,
        notes: phase.notes,
        sortOrder: phase.sortOrder,
      })
      .returning({ id: lessonPhases.id })

    if (phase.materials.length) {
      await db.insert(lessonPhaseMaterials).values(
        phase.materials.map((material) => ({
          phaseId: newPhase!.id,
          materialId: material.materialId,
          variantId: material.variantId,
          note: material.note,
          sortOrder: material.sortOrder,
        })),
      )
    }
  }

  if (source.materials.length) {
    await db.insert(lessonMaterials).values(
      source.materials.map((material) => ({
        lessonId: newId,
        materialId: material.materialId,
        variantId: material.variantId,
        usage: material.usage,
        note: material.note,
        sortOrder: material.sortOrder,
      })),
    )
  }

  queueReindex('unterrichtsstunde', newId)
  if (targetSeriesId) queueReindex('reihe', targetSeriesId)
  return newId
}

// --- Phasen ------------------------------------------------------------------

export async function addPhase(
  lessonId: string,
  input: PhaseInput,
  db: Database = useDatabase(),
): Promise<string> {
  const [{ value: highest } = { value: null }] = await db
    .select({ value: max(lessonPhases.sortOrder) })
    .from(lessonPhases)
    .where(eq(lessonPhases.lessonId, lessonId))

  const [created] = await db
    .insert(lessonPhases)
    .values({
      lessonId,
      name: input.name.trim() || 'Neue Phase',
      durationMinutes: input.durationMinutes ?? null,
      content: sanitizeText(input.content),
      teacherActivity: sanitizeText(input.teacherActivity),
      studentActivity: sanitizeText(input.studentActivity),
      method: sanitizeText(input.method, 200),
      socialForm: (input.socialForm as never) ?? null,
      notes: sanitizeText(input.notes),
      sortOrder: (highest ?? -1) + 1,
    })
    .returning({ id: lessonPhases.id })

  queueReindex('unterrichtsstunde', lessonId)
  return created!.id
}

export async function updatePhase(
  phaseId: string,
  input: Partial<PhaseInput>,
  db: Database = useDatabase(),
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name.trim()
  if (input.durationMinutes !== undefined) patch.durationMinutes = input.durationMinutes
  if (input.content !== undefined) patch.content = sanitizeText(input.content)
  if (input.teacherActivity !== undefined) patch.teacherActivity = sanitizeText(input.teacherActivity)
  if (input.studentActivity !== undefined) patch.studentActivity = sanitizeText(input.studentActivity)
  if (input.method !== undefined) patch.method = sanitizeText(input.method, 200)
  if (input.socialForm !== undefined) patch.socialForm = input.socialForm
  if (input.notes !== undefined) patch.notes = sanitizeText(input.notes)

  const [updated] = await db
    .update(lessonPhases)
    .set(patch as never)
    .where(eq(lessonPhases.id, phaseId))
    .returning({ lessonId: lessonPhases.lessonId })

  if (!updated) throw notFound('Die Unterrichtsphase')
  queueReindex('unterrichtsstunde', updated.lessonId)
}

export async function deletePhase(phaseId: string, db: Database = useDatabase()): Promise<void> {
  const removed = await db
    .delete(lessonPhases)
    .where(eq(lessonPhases.id, phaseId))
    .returning({ lessonId: lessonPhases.lessonId })
  if (!removed[0]) throw notFound('Die Unterrichtsphase')
  queueReindex('unterrichtsstunde', removed[0].lessonId)
}

export async function reorderPhases(
  lessonId: string,
  orderedIds: string[],
  db: Database = useDatabase(),
): Promise<void> {
  for (const [index, id] of orderedIds.entries()) {
    await db
      .update(lessonPhases)
      .set({ sortOrder: index })
      .where(and(eq(lessonPhases.id, id), eq(lessonPhases.lessonId, lessonId)))
  }
  queueReindex('unterrichtsstunde', lessonId)
}

// --- Materialzuordnung -------------------------------------------------------

export async function attachMaterial(
  lessonId: string,
  input: {
    materialId: string
    variantId?: string | null
    usage?: string
    note?: string | null
  },
  db: Database = useDatabase(),
): Promise<string> {
  const [{ value: highest } = { value: null }] = await db
    .select({ value: max(lessonMaterials.sortOrder) })
    .from(lessonMaterials)
    .where(eq(lessonMaterials.lessonId, lessonId))

  const [created] = await db
    .insert(lessonMaterials)
    .values({
      lessonId,
      materialId: input.materialId,
      variantId: input.variantId ?? null,
      usage: (input.usage as never) ?? 'unterricht',
      note: sanitizeText(input.note, 1000),
      sortOrder: (highest ?? -1) + 1,
    })
    .returning({ id: lessonMaterials.id })

  await markMaterialUsed([input.materialId], db)
  queueReindex('unterrichtsstunde', lessonId)
  return created!.id
}

export async function updateLessonMaterial(
  id: string,
  input: { usage?: string; note?: string | null; variantId?: string | null },
  db: Database = useDatabase(),
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (input.usage !== undefined) patch.usage = input.usage
  if (input.note !== undefined) patch.note = sanitizeText(input.note, 1000)
  if (input.variantId !== undefined) patch.variantId = input.variantId

  const [updated] = await db
    .update(lessonMaterials)
    .set(patch as never)
    .where(eq(lessonMaterials.id, id))
    .returning({ lessonId: lessonMaterials.lessonId })
  if (!updated) throw notFound('Die Materialzuordnung')
  queueReindex('unterrichtsstunde', updated.lessonId)
}

export async function detachMaterial(id: string, db: Database = useDatabase()): Promise<void> {
  const removed = await db
    .delete(lessonMaterials)
    .where(eq(lessonMaterials.id, id))
    .returning({ lessonId: lessonMaterials.lessonId })
  if (!removed[0]) throw notFound('Die Materialzuordnung')
  queueReindex('unterrichtsstunde', removed[0].lessonId)
}

export async function reorderLessonMaterials(
  lessonId: string,
  orderedIds: string[],
  db: Database = useDatabase(),
): Promise<void> {
  for (const [index, id] of orderedIds.entries()) {
    await db
      .update(lessonMaterials)
      .set({ sortOrder: index })
      .where(and(eq(lessonMaterials.id, id), eq(lessonMaterials.lessonId, lessonId)))
  }
}

export async function attachMaterialToPhase(
  phaseId: string,
  input: { materialId: string; variantId?: string | null; note?: string | null },
  db: Database = useDatabase(),
): Promise<string> {
  const [{ value: highest } = { value: null }] = await db
    .select({ value: max(lessonPhaseMaterials.sortOrder) })
    .from(lessonPhaseMaterials)
    .where(eq(lessonPhaseMaterials.phaseId, phaseId))

  const [created] = await db
    .insert(lessonPhaseMaterials)
    .values({
      phaseId,
      materialId: input.materialId,
      variantId: input.variantId ?? null,
      note: sanitizeText(input.note, 1000),
      sortOrder: (highest ?? -1) + 1,
    })
    .returning({ id: lessonPhaseMaterials.id })

  await markMaterialUsed([input.materialId], db)

  const [phase] = await db
    .select({ lessonId: lessonPhases.lessonId })
    .from(lessonPhases)
    .where(eq(lessonPhases.id, phaseId))
    .limit(1)
  if (phase) queueReindex('unterrichtsstunde', phase.lessonId)

  return created!.id
}

export async function detachMaterialFromPhase(
  id: string,
  db: Database = useDatabase(),
): Promise<void> {
  const removed = await db
    .delete(lessonPhaseMaterials)
    .where(eq(lessonPhaseMaterials.id, id))
    .returning({ phaseId: lessonPhaseMaterials.phaseId })
  if (!removed[0]) throw notFound('Die Materialzuordnung')
}

export async function getDetailOrThrow(
  id: string,
  db: Database = useDatabase(),
): Promise<LessonDetail> {
  const detail = await getLessonDetail(id, db)
  if (!detail) throw notFound('Die Unterrichtsstunde')
  return detail
}

/** Summiert die geplanten Phasendauern – Hinweis auf Über- oder Unterplanung. */
export async function getPlannedDuration(
  lessonId: string,
  db: Database = useDatabase(),
): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`coalesce(sum(${lessonPhases.durationMinutes}), 0)::int` })
    .from(lessonPhases)
    .where(eq(lessonPhases.lessonId, lessonId))
  return row?.value ?? 0
}
