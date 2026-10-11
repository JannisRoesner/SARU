import { removeLessonFromSeries } from '../../../../services/series.service'
import { requireSeriesBearbeiten } from '../../../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../../../utils/validation'

/** Nimmt eine Stunde aus der Reihe heraus; die Stunde selbst bleibt erhalten. */
export default defineEventHandler(async (event) => {
  const seriesId = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const lessonId = parseOrThrow(uuidSchema, getRouterParam(event, 'lessonId'))
  await requireSeriesBearbeiten(event, seriesId)

  await removeLessonFromSeries(lessonId)
  return { erfolg: true }
})
