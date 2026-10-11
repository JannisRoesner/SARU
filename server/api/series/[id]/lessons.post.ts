import { z } from 'zod'
import { getSeriesDetail } from '../../../repositories/series.repository'
import { addLessonToSeries } from '../../../services/series.service'
import { requireSeriesBearbeiten } from '../../../utils/permissions'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  await requireSeriesBearbeiten(event, id)
  const { lessonId, position } = await readZodBody(
    event,
    z.object({ lessonId: uuidSchema, position: z.coerce.number().int().min(0).optional() }),
  )

  await addLessonToSeries(id, lessonId, position)
  return getSeriesDetail(id)
})
