import { readFile } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { useDatabase } from '../database/client'
import { materialAssets } from '../database/schema'
import { appError, notFound } from '../utils/errors'
import { rasterizePdf } from './ai/rasterize'
import { fileExists, isInlineSafe, readFileStream, resolveStoragePath } from './storage.service'
import { canHaveThumbnail, ensureThumbnail, thumbnailStorageKey } from './thumbnail.service'

/**
 * Auslieferung von Dateien, Miniaturen und PDF-Seitenbildern.
 * Gemeinsam für angemeldete Nutzer und Freigabe-Links – die Rechteprüfung passiert vorher
 * im jeweiligen Endpunkt. Der Pfad kommt ausschließlich aus dem Datenbankeintrag.
 */

export async function sendeDatei(event: H3Event, assetId: string, inline: boolean) {
  const [asset] = await useDatabase()
    .select()
    .from(materialAssets)
    .where(eq(materialAssets.id, assetId))
    .limit(1)

  if (!asset || asset.kind !== 'datei' || !asset.storageKey) throw notFound('Die Datei')
  if (!(await fileExists(asset.storageKey))) throw notFound('Die Datei')

  // Nur unkritische Typen dürfen im Browser gerendert werden; alles andere
  // wird zum Download gezwungen, damit kein HTML/SVG im Kontext der App läuft.
  const showInline = inline && isInlineSafe(asset.mimeType)
  const fileName = asset.fileName ?? 'datei'

  setResponseHeader(event, 'content-type', showInline ? asset.mimeType! : 'application/octet-stream')
  setResponseHeader(
    event,
    'content-disposition',
    `${showInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  )
  if (asset.sizeBytes) setResponseHeader(event, 'content-length', asset.sizeBytes)
  setResponseHeader(event, 'cache-control', 'private, max-age=300')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  // Bei Inline-Anzeige kein `sandbox`: sonst blockiert der Browser die PDF-/Bildvorschau im iframe.
  if (!showInline) {
    setResponseHeader(event, 'content-security-policy', "default-src 'none'; object-src 'none'; sandbox")
  } else {
    setResponseHeader(event, 'content-security-policy', "default-src 'none'; object-src 'self'; frame-ancestors 'self'")
  }

  return sendStream(event, readFileStream(asset.storageKey))
}

export async function sendeMiniatur(event: H3Event, assetId: string) {
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
}

/** PDF-Seite als PNG. `page` 1-basiert, `scale` 1–3. */
export async function sendeSeite(event: H3Event, assetId: string, pageRaw: unknown, scaleRaw: unknown) {
  const page = Math.max(1, Math.min(40, Number(pageRaw ?? 1) || 1))
  const scale = Math.min(3, Math.max(1, Number(scaleRaw ?? 1.35) || 1.35))

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
  const pages = await rasterizePdf(buffer, { page, scale })
  const target = pages[0]
  if (!target) {
    throw notFound('Die PDF-Seite')
  }

  const png = Buffer.from(target.base64, 'base64')
  setResponseHeader(event, 'content-type', 'image/png')
  setResponseHeader(event, 'cache-control', 'private, max-age=300')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  setResponseHeader(event, 'content-disposition', `inline; filename="page-${page}.png"`)
  setResponseHeader(event, 'content-length', png.length)
  return png
}
