import { discardDifferentiationDraft } from '../../../services/ai/differenzierung/service'
import { requireEditor } from '../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  await discardDifferentiationDraft(id, user.id)
  setResponseStatus(event, 204)
})
