import { removeLessonFromSeries } from '../../../../services/series.service'
import { requireEditor } from '../../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../../utils/validation'

/** Nimmt eine Stunde aus der Reihe heraus; die Stunde selbst bleibt erhalten. */
export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const lessonId = parseOrThrow(uuidSchema, getRouterParam(event, 'lessonId'))

  await removeLessonFromSeries(lessonId)
  return { erfolg: true }
})
