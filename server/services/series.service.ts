import { and, asc, eq, max } from 'drizzle-orm'
import { useDatabase, type Database } from '../database/client'
import {
  lessons,
  series,
  seriesCompetencies,
  seriesMaterials,
  seriesTags,
} from '../database/schema'
import { invalidInput, notFound } from '../utils/errors'
import { createLogger } from '../utils/logger'
import { sanitizeText } from '../utils/validation'
import { getSeriesDetail, type SeriesDetail } from '../repositories/series.repository'
import { queueReindex, removeFromIndex } from './search/indexer'
import { markMaterialUsed } from './material.service'
import { resolveCompetencyIds, resolveSubjectIdFromInput, resolveTagIds } from './taxonomy.service'

const log = createLogger('series')

export interface SeriesInput {
  title: string
  description?: string | null
  subjectId?: string | null
  subjectName?: string | null
  learningGroupId?: string | null
  topicId?: string | null
  startDate?: string | null
  endDate?: string | null
  schoolYear?: string | null
  learningObjectives?: string[]
  notes?: string | null
  status?: string
  origin?: 'manuell' | 'ki' | 'import'
  tagNames?: string[]
  competencyIds?: string[]
  competencyNames?: string[]
}

function seriesColumns(input: Partial<SeriesInput>) {
  const patch: Record<string, unknown> = {}
  if (input.title !== undefined) patch.title = input.title.trim()
  if (input.description !== undefined) patch.description = sanitizeText(input.description)
  if (input.subjectId !== undefined) patch.subjectId = input.subjectId
  if (input.learningGroupId !== undefined) patch.learningGroupId = input.learningGroupId
  if (input.topicId !== undefined) patch.topicId = input.topicId
  if (input.startDate !== undefined) patch.startDate = input.startDate || null
  if (input.endDate !== undefined) patch.endDate = input.endDate || null
  if (input.schoolYear !== undefined) patch.schoolYear = sanitizeText(input.schoolYear, 20)
  if (input.notes !== undefined) patch.notes = sanitizeText(input.notes)
  if (input.status !== undefined) patch.status = input.status
  if (input.origin !== undefined) patch.origin = input.origin
  if (input.learningObjectives !== undefined) {
    patch.learningObjectives = input.learningObjectives
      .map((o) => o.trim())
      .filter(Boolean)
      .slice(0, 50)
  }
  return patch
}

async function applySeriesTaxonomy(
  db: Database,
  seriesId: string,
  input: Partial<SeriesInput>,
): Promise<void> {
  if (input.tagNames !== undefined) {
    const tagIds = await resolveTagIds(input.tagNames, db)
    await db.delete(seriesTags).where(eq(seriesTags.seriesId, seriesId))
    if (tagIds.length) {
      await db
        .insert(seriesTags)
        .values(tagIds.map((tagId) => ({ seriesId, tagId })))
        .onConflictDoNothing()
    }
  }

  if (input.competencyIds !== undefined || input.competencyNames !== undefined) {
    const ids = [...(input.competencyIds ?? [])]
    if (input.competencyNames?.length) {
      const [row] = await db
        .select({ subjectId: series.subjectId })
        .from(series)
        .where(eq(series.id, seriesId))
        .limit(1)
      ids.push(...(await resolveCompetencyIds(input.competencyNames, row?.subjectId ?? null, db)))
    }
    await db.delete(seriesCompetencies).where(eq(seriesCompetencies.seriesId, seriesId))
    const unique = [...new Set(ids)]
    if (unique.length) {
      await db
        .insert(seriesCompetencies)
        .values(unique.map((competencyId) => ({ seriesId, competencyId })))
        .onConflictDoNothing()
    }
  }
}

export async function createSeries(
  input: SeriesInput,
  ownerId: string | null,
  db: Database = useDatabase(),
): Promise<string> {
  if (!input.title?.trim()) throw invalidInput('Bitte einen Titel für die Reihe angeben.')

  const subjectId = await resolveSubjectIdFromInput(input.subjectId, input.subjectName, db)

  const [created] = await db
    .insert(series)
    .values({ ...seriesColumns({ ...input, subjectId }), title: input.title.trim(), ownerId } as never)
    .returning({ id: series.id })

  const seriesId = created!.id
  await applySeriesTaxonomy(db, seriesId, input)

  queueReindex('reihe', seriesId)
  log.info('Reihe angelegt', { seriesId, title: input.title })
  return seriesId
}

export async function updateSeries(
  id: string,
  input: Partial<SeriesInput>,
  db: Database = useDatabase(),
): Promise<void> {
  let patchInput: Partial<SeriesInput> = input
  if (input.subjectId !== undefined || input.subjectName !== undefined) {
    patchInput = {
      ...input,
      subjectId: await resolveSubjectIdFromInput(input.subjectId, input.subjectName, db),
    }
  }

  const patch = seriesColumns(patchInput)
  if (Object.keys(patch).length > 0) {
    const [updated] = await db
      .update(series)
      .set({ ...patch, updatedAt: new Date() } as never)
      .where(eq(series.id, id))
      .returning({ id: series.id })
    if (!updated) throw notFound('Die Reihe')
  }
  await applySeriesTaxonomy(db, id, input)
  queueReindex('reihe', id)
}

export async function deleteSeries(
  id: string,
  options: { deleteLessons?: boolean } = {},
  db: Database = useDatabase(),
): Promise<void> {
  const affected = await db
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.seriesId, id))

  if (options.deleteLessons) {
    await db.delete(lessons).where(eq(lessons.seriesId, id))
    for (const lesson of affected) await removeFromIndex('unterrichtsstunde', lesson.id)
  }

  const removed = await db.delete(series).where(eq(series.id, id)).returning({ id: series.id })
  if (!removed[0]) throw notFound('Die Reihe')

  await removeFromIndex('reihe', id)
  // Verbliebene Stunden verlieren nur die Zuordnung (ON DELETE SET NULL).
  if (!options.deleteLessons) {
    for (const lesson of affected) queueReindex('unterrichtsstunde', lesson.id)
  }
}

/** Ordnet die Stunden einer Reihe neu und schreibt fortlaufende Positionen. */
export async function reorderLessons(
  seriesId: string,
  orderedLessonIds: string[],
  db: Database = useDatabase(),
): Promise<void> {
  for (const [index, lessonId] of orderedLessonIds.entries()) {
    await db
      .update(lessons)
      .set({ positionInSeries: index })
      .where(and(eq(lessons.id, lessonId), eq(lessons.seriesId, seriesId)))
  }
  queueReindex('reihe', seriesId)
}

export async function addLessonToSeries(
  seriesId: string,
  lessonId: string,
  position?: number,
  db: Database = useDatabase(),
): Promise<void> {
  let target = position
  if (target === undefined) {
    const [{ value } = { value: null }] = await db
      .select({ value: max(lessons.positionInSeries) })
      .from(lessons)
      .where(eq(lessons.seriesId, seriesId))
    target = (value ?? -1) + 1
  }

  const [updated] = await db
    .update(lessons)
    .set({ seriesId, positionInSeries: target, updatedAt: new Date() })
    .where(eq(lessons.id, lessonId))
    .returning({ id: lessons.id })
  if (!updated) throw notFound('Die Unterrichtsstunde')

  queueReindex('reihe', seriesId)
  queueReindex('unterrichtsstunde', lessonId)
}

export async function removeLessonFromSeries(
  lessonId: string,
  db: Database = useDatabase(),
): Promise<void> {
  const [updated] = await db
    .update(lessons)
    .set({ seriesId: null, positionInSeries: null, updatedAt: new Date() })
    .where(eq(lessons.id, lessonId))
    .returning({ seriesId: lessons.seriesId })
  if (updated === undefined) throw notFound('Die Unterrichtsstunde')
  queueReindex('unterrichtsstunde', lessonId)
}

/** Schließt Lücken in der Reihenfolge, z. B. nach dem Entfernen einer Stunde. */
export async function normalizePositions(
  seriesId: string,
  db: Database = useDatabase(),
): Promise<void> {
  const ordered = await db
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.seriesId, seriesId))
    .orderBy(asc(lessons.positionInSeries), asc(lessons.date))

  await reorderLessons(
    seriesId,
    ordered.map((row) => row.id),
    db,
  )
}

export async function attachMaterialToSeries(
  seriesId: string,
  input: { materialId: string; variantId?: string | null; note?: string | null },
  db: Database = useDatabase(),
): Promise<string> {
  const [{ value: highest } = { value: null }] = await db
    .select({ value: max(seriesMaterials.sortOrder) })
    .from(seriesMaterials)
    .where(eq(seriesMaterials.seriesId, seriesId))

  const [created] = await db
    .insert(seriesMaterials)
    .values({
      seriesId,
      materialId: input.materialId,
      variantId: input.variantId ?? null,
      note: sanitizeText(input.note, 1000),
      sortOrder: (highest ?? -1) + 1,
    })
    .returning({ id: seriesMaterials.id })

  await markMaterialUsed([input.materialId], db)
  queueReindex('reihe', seriesId)
  return created!.id
}

export async function detachMaterialFromSeries(
  id: string,
  db: Database = useDatabase(),
): Promise<void> {
  const removed = await db
    .delete(seriesMaterials)
    .where(eq(seriesMaterials.id, id))
    .returning({ seriesId: seriesMaterials.seriesId })
  if (!removed[0]) throw notFound('Die Materialzuordnung')
  queueReindex('reihe', removed[0].seriesId)
}

export async function getDetailOrThrow(
  id: string,
  db: Database = useDatabase(),
): Promise<SeriesDetail> {
  const detail = await getSeriesDetail(id, db)
  if (!detail) throw notFound('Die Reihe')
  return detail
}
