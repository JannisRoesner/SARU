import { detachMaterialFromPhase } from '../../services/lesson.service'
import { requireEditor } from '../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))

  await detachMaterialFromPhase(id)
  return { erfolg: true }
})
