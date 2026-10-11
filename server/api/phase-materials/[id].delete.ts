import { detachMaterialFromPhase } from '../../services/lesson.service'
import { requirePhaseMaterialBearbeiten } from '../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  await requirePhaseMaterialBearbeiten(event, id)

  await detachMaterialFromPhase(id)
  return { erfolg: true }
})
