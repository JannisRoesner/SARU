import { eq } from 'drizzle-orm'
import { useDatabase } from '../../../../database/client'
import { materialAssets } from '../../../../database/schema'
import { verifyWopiAccessToken } from '../../../../services/collabora.service'
import { fileExists } from '../../../../services/storage.service'
import { appError, notFound } from '../../../../utils/errors'
import { parseOrThrow, uuidSchema } from '../../../../utils/validation'

/**
 * WOPI CheckFileInfo – Collabora fragt Metadaten ab (ohne Session-Cookie).
 * Authentifizierung über `access_token` (Query oder Header).
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

  const [asset] = await useDatabase()
    .select()
    .from(materialAssets)
    .where(eq(materialAssets.id, fileId))
    .limit(1)

  if (!asset || asset.kind !== 'datei' || !asset.storageKey) throw notFound('Die Datei')
  if (!(await fileExists(asset.storageKey))) throw notFound('Die Datei')

  return {
    BaseFileName: asset.fileName ?? 'dokument',
    Size: asset.sizeBytes ?? 0,
    OwnerId: claims.userId,
    UserId: claims.userId,
    UserFriendlyName: claims.userName,
    UserCanWrite: false,
    UserCanNotWriteRelative: true,
    SupportsUpdate: false,
    SupportsLocks: false,
    SupportsGetLock: false,
    SupportsExtendedLockLength: false,
    DisablePrint: false,
    DisableExport: false,
    DisableCopy: false,
    EnableOwnerTermination: false,
    PostMessageOrigin: getRequestURL(event).origin,
    LastModifiedTime: asset.createdAt?.toISOString?.() ?? new Date().toISOString(),
  }
})
