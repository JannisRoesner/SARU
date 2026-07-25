import { eq } from 'drizzle-orm'
import { useDatabase } from '../../../../database/client'
import { materialAssets } from '../../../../database/schema'
import { verifyWopiAccessToken } from '../../../../services/collabora.service'
import { fileExists, readFileStream } from '../../../../services/storage.service'
import { appError, notFound } from '../../../../utils/errors'
import { parseOrThrow, uuidSchema } from '../../../../utils/validation'

/** WOPI GetFile – liefert den Dateiinhalt an Collabora Online. */
export default defineEventHandler(async (event) => {
  const fileId = parseOrThrow(uuidSchema, getRouterParam(event, 'fileId'))
  const query = getQuery(event)
  const headerToken = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '')
  const token = String(query.access_token ?? headerToken ?? '')
  const claims = verifyWopiAccessToken(token)
  if (!claims || claims.assetId !== fileId) {
    throw appError('KEINE_BERECHTIGUNG', 'Ungültiger oder abgelaufener WOPI-Token.')
  }

  const [asset] = await useDatabase()
    .select()
    .from(materialAssets)
    .where(eq(materialAssets.id, fileId))
    .limit(1)

  if (!asset || asset.kind !== 'datei' || !asset.storageKey) throw notFound('Die Datei')
  if (!(await fileExists(asset.storageKey))) throw notFound('Die Datei')

  setResponseHeader(event, 'content-type', asset.mimeType ?? 'application/octet-stream')
  if (asset.sizeBytes) setResponseHeader(event, 'content-length', asset.sizeBytes)
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  setResponseHeader(event, 'cache-control', 'private, no-store')

  return sendStream(event, readFileStream(asset.storageKey))
})
