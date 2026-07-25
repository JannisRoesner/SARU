import { z } from 'zod'
import { getSeriesDetail } from '../../../repositories/series.repository'
import { addLessonToSeries } from '../../../services/series.service'
import { requireEditor } from '../../../utils/auth'
import { parseOrThrow, readValidatedBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const { lessonId, position } = await readValidatedBody(
    event,
    z.object({ lessonId: uuidSchema, position: z.coerce.number().int().min(0).optional() }),
  )

  await addLessonToSeries(id, lessonId, position)
  return getSeriesDetail(id)
})
