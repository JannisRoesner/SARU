import { detachMaterial } from '../../services/lesson.service'
import { requireEditor } from '../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../utils/validation'

/** Löst die Zuordnung eines Materials zu einer Stunde; das Material bleibt bestehen. */
export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))

  await detachMaterial(id)
  return { erfolg: true }
})
