import { deletePhase } from '../../../services/lesson.service'
import { requireEditor } from '../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const phaseId = parseOrThrow(uuidSchema, getRouterParam(event, 'phaseId'))

  await deletePhase(phaseId)
  return { erfolg: true }
})
