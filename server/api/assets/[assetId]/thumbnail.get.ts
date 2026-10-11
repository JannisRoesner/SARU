import { sendeMiniatur } from '../../../services/asset-delivery.service'
import { requireUser } from '../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/**
 * Liefert eine zwischengespeicherte Dokument-Miniatur (PNG).
 * Wird bei Bedarf aus der ersten PDF-Seite, einem Bild oder einem Office-Dokument erzeugt.
 */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const assetId = parseOrThrow(uuidSchema, getRouterParam(event, 'assetId'))
  return sendeMiniatur(event, assetId)
})
