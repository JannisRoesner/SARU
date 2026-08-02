import { attachMaterialToPhase } from '../../../services/lesson.service'
import { requireEditor } from '../../../utils/auth'
import { materialRefSchema } from '../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const phaseId = parseOrThrow(uuidSchema, getRouterParam(event, 'phaseId'))
  const input = await readZodBody(event, materialRefSchema)

  const id = await attachMaterialToPhase(phaseId, input)
  setResponseStatus(event, 201)
  return { id }
})
