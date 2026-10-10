import { getAssetPreviewInfo } from '../../../services/preview.service'
import { requireUser } from '../../../utils/auth'
import { notFound } from '../../../utils/errors'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/** Metadaten zur In-App-Vorschau (PDF/Bild nativ, Office optional via Collabora). */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const assetId = parseOrThrow(uuidSchema, getRouterParam(event, 'assetId'))

  const origin = getRequestURL(event).origin
  // Office-Dokumente öffnen nur lesend – Bearbeiten muss ausdrücklich angefordert werden.
  const bearbeiten = ['1', 'true'].includes(String(getQuery(event).bearbeiten ?? ''))
  const info = await getAssetPreviewInfo(assetId, user, origin, { bearbeiten })
  if (!info) throw notFound('Die Datei')
  return info
})
