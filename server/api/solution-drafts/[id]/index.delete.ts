import { discardSolutionDraft } from '../../../services/ai/solutions-v2/draft-service'
import { requireLoesungsEntwurf } from '../../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const user = await requireLoesungsEntwurf(event, id)
  await discardSolutionDraft(id, user.id)
  setResponseStatus(event, 204)
  return null
})

