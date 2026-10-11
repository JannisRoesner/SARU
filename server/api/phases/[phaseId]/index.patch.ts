import { updatePhase } from '../../../services/lesson.service'
import { requirePhaseBearbeiten } from '../../../utils/permissions'
import { lessonPhaseSchema } from '../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const phaseId = parseOrThrow(uuidSchema, getRouterParam(event, 'phaseId'))
  await requirePhaseBearbeiten(event, phaseId)
  const patch = await readZodBody(event, lessonPhaseSchema.partial())

  await updatePhase(phaseId, patch)
  return { erfolg: true }
})
