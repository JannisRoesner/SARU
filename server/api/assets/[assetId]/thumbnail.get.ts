import { eq } from 'drizzle-orm'
import { useDatabase } from '../../../database/client'
import { materialAssets } from '../../../database/schema'
import { readFileStream } from '../../../services/storage.service'
import {
  canHaveThumbnail,
  ensureThumbnail,
  thumbnailStorageKey,
} from '../../../services/thumbnail.service'
import { requireUser } from '../../../utils/auth'
import { notFound } from '../../../utils/errors'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/**
 * Liefert eine zwischengespeicherte Dokument-Miniatur (PNG).
 * Wird bei Bedarf aus der ersten PDF-Seite, einem Bild oder einem Office-Dokument erzeugt.
 */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const assetId = parseOrThrow(uuidSchema, getRouterParam(event, 'assetId'))

  const [asset] = await useDatabase()
    .select({
      kind: materialAssets.kind,
      mimeType: materialAssets.mimeType,
      fileName: materialAssets.fileName,
    })
    .from(materialAssets)
    .where(eq(materialAssets.id, assetId))
    .limit(1)

  if (!asset || asset.kind !== 'datei') throw notFound('Die Datei')
  if (!canHaveThumbnail(asset.mimeType, asset.fileName)) {
    throw notFound('Die Miniatur')
  }

  const key = await ensureThumbnail(assetId)
  if (!key) throw notFound('Die Miniatur')

  setResponseHeader(event, 'content-type', 'image/png')
  setResponseHeader(event, 'cache-control', 'private, max-age=86400')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  setResponseHeader(event, 'content-disposition', `inline; filename="${thumbnailStorageKey(assetId).split('/').pop()}"`)

  return sendStream(event, readFileStream(key))
})
