import { publishSolutionDraft } from '../../../services/ai/solutions-v2/draft-service'
import { requireEditor } from '../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  return publishSolutionDraft(id, user.id)
})

