import { getSolutionDraftPage } from '../../../../services/ai/solutions-v2/draft-service'
import { requireEditor } from '../../../../utils/auth'
import { appError } from '../../../../utils/errors'
import { parseOrThrow, uuidSchema } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const page = Number(getRouterParam(event, 'page'))
  if (!Number.isInteger(page) || page < 1 || page > 200) {
    throw appError('UNGUELTIGE_EINGABE', 'Die Seitennummer ist ungültig.')
  }
  const image = await getSolutionDraftPage(id, user.id, page)
  setResponseHeader(event, 'content-type', image.mimeType)
  setResponseHeader(event, 'cache-control', 'private, no-store')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  return image.buffer
})
