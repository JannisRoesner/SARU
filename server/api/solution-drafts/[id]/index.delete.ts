import { discardSolutionDraft } from '../../../services/ai/solutions-v2/draft-service'
import { requireEditor } from '../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  await discardSolutionDraft(id, user.id)
  setResponseStatus(event, 204)
  return null
})

