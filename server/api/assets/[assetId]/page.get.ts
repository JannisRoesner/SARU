import { eq } from 'drizzle-orm'
import { useDatabase } from '../../../database/client'
import { materialAssets } from '../../../database/schema'
import { rasterizePdf } from '../../../services/ai/rasterize'
import { resolveStoragePath } from '../../../services/storage.service'
import { requireUser } from '../../../utils/auth'
import { appError, notFound } from '../../../utils/errors'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'
import { readFile } from 'node:fs/promises'
import { getQuery } from 'h3'

/**
 * Liefert eine PDF-Seite als PNG (für visuelle Nachbearbeitung der KI-Overlay-Positionen).
 * Query: `page` (1-basiert, Standard 1).
 */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const assetId = parseOrThrow(uuidSchema, getRouterParam(event, 'assetId'))
  const query = getQuery(event)
  const page = Math.max(1, Math.min(40, Number(query.page ?? 1) || 1))

  const [asset] = await useDatabase()
    .select({
      kind: materialAssets.kind,
      storageKey: materialAssets.storageKey,
      mimeType: materialAssets.mimeType,
      fileName: materialAssets.fileName,
    })
    .from(materialAssets)
    .where(eq(materialAssets.id, assetId))
    .limit(1)

  if (!asset || asset.kind !== 'datei' || !asset.storageKey) throw notFound('Die Datei')

  const isPdf =
    asset.mimeType === 'application/pdf' ||
    (asset.fileName ?? '').toLowerCase().endsWith('.pdf')
  if (!isPdf) {
    throw appError('UNGUELTIGE_EINGABE', 'Seitenbilder stehen nur für PDF-Dateien zur Verfügung.')
  }

  const buffer = await readFile(resolveStoragePath(asset.storageKey))
  const pages = await rasterizePdf(buffer, { page, scale: 1.35 })
  const target = pages[0]
  if (!target) {
    throw notFound('Die PDF-Seite')
  }

  const png = Buffer.from(target.base64, 'base64')
  setResponseHeader(event, 'content-type', 'image/png')
  setResponseHeader(event, 'cache-control', 'private, max-age=300')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  setResponseHeader(event, 'content-disposition', `inline; filename="page-${page}.png"`)
  setResponseHeader(event, 'content-length', String(png.length))
  return png
})
