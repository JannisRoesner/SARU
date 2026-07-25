import { getAssetPreviewInfo } from '../../../services/preview.service'
import { requireUser } from '../../../utils/auth'
import { notFound } from '../../../utils/errors'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/** Metadaten zur In-App-Vorschau (PDF/Bild nativ, Office optional via Collabora). */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const assetId = parseOrThrow(uuidSchema, getRouterParam(event, 'assetId'))

  const origin = getRequestURL(event).origin
  const info = await getAssetPreviewInfo(assetId, user, origin)
  if (!info) throw notFound('Die Datei')
  return info
})
