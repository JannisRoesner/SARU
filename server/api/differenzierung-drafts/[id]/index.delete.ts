import { discardDifferentiationDraft } from '../../../services/ai/differenzierung/service'
import { requireDifferenzierungsEntwurf } from '../../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const user = await requireDifferenzierungsEntwurf(event, id)
  await discardDifferentiationDraft(id, user.id)
  setResponseStatus(event, 204)
})
