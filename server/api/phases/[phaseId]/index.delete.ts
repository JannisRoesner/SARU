import { deletePhase } from '../../../services/lesson.service'
import { requirePhaseBearbeiten } from '../../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const phaseId = parseOrThrow(uuidSchema, getRouterParam(event, 'phaseId'))
  await requirePhaseBearbeiten(event, phaseId)

  await deletePhase(phaseId)
  return { erfolg: true }
})
