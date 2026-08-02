import { eq } from 'drizzle-orm'
import { readRawBody } from 'h3'
import { useDatabase } from '../../../../database/client'
import { materialAssets } from '../../../../database/schema'
import { verifyWopiAccessToken } from '../../../../services/collabora.service'
import { extractAssetText } from '../../../../services/material.service'
import { isExtractable } from '../../../../services/extraction.service'
import { fileExists, overwriteFile } from '../../../../services/storage.service'
import { deleteThumbnail, queueThumbnailGeneration } from '../../../../services/thumbnail.service'
import { appError, notFound } from '../../../../utils/errors'
import { createLogger } from '../../../../utils/logger'
import { parseOrThrow, uuidSchema } from '../../../../utils/validation'

const log = createLogger('wopi')

/**
 * WOPI PutFile – Collabora speichert den bearbeiteten Dateiinhalt.
 * Body: Rohbytes der Datei (application/octet-stream).
 */
export default defineEventHandler(async (event) => {
  const fileId = parseOrThrow(uuidSchema, getRouterParam(event, 'fileId'))
  const query = getQuery(event)
  const headerToken = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '')
  const token = String(query.access_token ?? headerToken ?? '')
  const claims = verifyWopiAccessToken(token)
  if (!claims || claims.assetId !== fileId) {
    throw appError('KEINE_BERECHTIGUNG', 'Ungültiger oder abgelaufener WOPI-Token.')
  }
  if (!claims.canWrite) {
    throw appError('KEINE_BERECHTIGUNG', 'Keine Schreibberechtigung für dieses Dokument.')
  }

  const db = useDatabase()
  const [asset] = await db
    .select()
    .from(materialAssets)
    .where(eq(materialAssets.id, fileId))
    .limit(1)

  if (!asset || asset.kind !== 'datei' || !asset.storageKey) throw notFound('Die Datei')
  if (!(await fileExists(asset.storageKey))) throw notFound('Die Datei')

  const raw = await readRawBody(event, false)
  const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw ?? [])
  if (buffer.length === 0) {
    throw appError('UNGUELTIGE_EINGABE', 'Leerer Dateiinhalt – Speichern abgebrochen.')
  }

  const stored = await overwriteFile(asset.storageKey, buffer)

  await db
    .update(materialAssets)
    .set({
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      extractedText: null,
      extractionError: null,
      extractionStatus: isExtractable(asset.fileName ?? '')
        ? 'ausstehend'
        : 'nicht_unterstuetzt',
    })
    .where(eq(materialAssets.id, fileId))

  void deleteThumbnail(fileId)
    .catch(() => {})
    .finally(() => {
      queueThumbnailGeneration(fileId, asset.mimeType ?? 'application/octet-stream', asset.fileName)
    })
  void extractAssetText(fileId)

  log.info('WOPI PutFile gespeichert', {
    assetId: fileId,
    userId: claims.userId,
    sizeBytes: stored.sizeBytes,
  })

  setResponseStatus(event, 200)
  return {
    LastModifiedTime: stored.modifiedAt.toISOString(),
    Size: stored.sizeBytes,
  }
})
