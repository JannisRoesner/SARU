import { html5Startadresse } from '../../../services/html5-paket.service'
import { requireUser } from '../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/** Startadresse eines HTML5-Pakets für den Player (mit befristetem Zugriffsschlüssel). */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const assetId = parseOrThrow(uuidSchema, getRouterParam(event, 'assetId'))
  return html5Startadresse(assetId)
})
