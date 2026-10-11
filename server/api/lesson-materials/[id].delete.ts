import { detachMaterial } from '../../services/lesson.service'
import { requireLessonMaterialBearbeiten } from '../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../utils/validation'

/** Löst die Zuordnung eines Materials zu einer Stunde; das Material bleibt bestehen. */
export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  await requireLessonMaterialBearbeiten(event, id)

  await detachMaterial(id)
  return { erfolg: true }
})
