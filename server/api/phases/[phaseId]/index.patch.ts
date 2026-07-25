import { updatePhase } from '../../../services/lesson.service'
import { requireEditor } from '../../../utils/auth'
import { lessonPhaseSchema } from '../../../utils/schemas'
import { parseOrThrow, readValidatedBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const phaseId = parseOrThrow(uuidSchema, getRouterParam(event, 'phaseId'))
  const patch = await readValidatedBody(event, lessonPhaseSchema.partial())

  await updatePhase(phaseId, patch)
  return { erfolg: true }
})
