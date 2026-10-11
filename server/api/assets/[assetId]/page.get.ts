import { getQuery } from 'h3'
import { sendeSeite } from '../../../services/asset-delivery.service'
import { requireUser } from '../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/**
 * Liefert eine PDF-Seite als PNG (für visuelle Nachbearbeitung der KI-Overlay-Positionen).
 * Query: `page` (1-basiert, Standard 1), `scale`.
 */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const assetId = parseOrThrow(uuidSchema, getRouterParam(event, 'assetId'))
  const query = getQuery(event)
  return sendeSeite(event, assetId, query.page, query.scale)
})
