import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { eq } from 'drizzle-orm'
import { useDatabase } from '../database/client'
import { materialAssets } from '../database/schema'
import { createLogger } from '../utils/logger'
import { rasterizePdf } from './ai/rasterize'
import {
  deleteFile,
  fileExists,
  resolveStoragePath,
  uploadRoot,
} from './storage.service'

const log = createLogger('thumbnail')

const THUMB_WIDTH = 320
const THUMB_HEIGHT = 420

/** Relativer Speicherort der Miniatur unter dem Upload-Verzeichnis. */
export function thumbnailStorageKey(assetId: string): string {
  return `.thumbs/${assetId}.png`
}

export async function deleteThumbnail(assetId: string): Promise<void> {
  await deleteFile(thumbnailStorageKey(assetId))
}

function isPdf(mimeType: string | null, fileName: string | null): boolean {
  if (mimeType === 'application/pdf') return true
  return (fileName ?? '').toLowerCase().endsWith('.pdf')
}

function isRasterImage(mimeType: string | null): boolean {
  if (!mimeType?.startsWith('image/')) return false
  return mimeType !== 'image/svg+xml'
}

/**
 * Erzeugt bei Bedarf eine PNG-Miniatur und speichert sie unter `.thumbs/`.
 * Unterstützt PDF (erste Seite) und Rasterbilder; andere Typen liefern `null`.
 */
export async function ensureThumbnail(assetId: string): Promise<string | null> {
  const key = thumbnailStorageKey(assetId)
  if (await fileExists(key)) return key

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

  if (!asset || asset.kind !== 'datei' || !asset.storageKey) return null
  if (!(await fileExists(asset.storageKey))) return null

  try {
    let png: Buffer | null = null

    if (isPdf(asset.mimeType, asset.fileName)) {
      const buffer = await readFile(resolveStoragePath(asset.storageKey))
      const pages = await rasterizePdf(buffer, { maxPages: 1, scale: 0.55 })
      const first = pages[0]
      if (!first) return null
      png = await fitPng(Buffer.from(first.base64, 'base64'))
    } else if (isRasterImage(asset.mimeType)) {
      const buffer = await readFile(resolveStoragePath(asset.storageKey))
      png = await resizeImageToThumb(buffer)
    } else {
      return null
    }

    if (!png) return null

    const target = resolveStoragePath(key)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, png, { mode: 0o640 })
    return key
  } catch (error) {
    log.warn('Miniatur konnte nicht erzeugt werden', { assetId, error })
    return null
  }
}

/** Prüft, ob für diesen Asset-Typ überhaupt eine Miniatur möglich ist. */
export function canHaveThumbnail(mimeType: string | null, fileName: string | null): boolean {
  return isPdf(mimeType, fileName) || isRasterImage(mimeType)
}

async function fitPng(pngBuffer: Buffer): Promise<Buffer | null> {
  let createCanvas: typeof import('@napi-rs/canvas').createCanvas
  let loadImage: typeof import('@napi-rs/canvas').loadImage
  try {
    ;({ createCanvas, loadImage } = await import('@napi-rs/canvas'))
  } catch {
    return pngBuffer
  }

  const image = await loadImage(pngBuffer)
  const { width, height } = containSize(image.width, image.height, THUMB_WIDTH, THUMB_HEIGHT)
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(image, 0, 0, width, height)
  return canvas.toBuffer('image/png')
}

async function resizeImageToThumb(buffer: Buffer): Promise<Buffer | null> {
  let createCanvas: typeof import('@napi-rs/canvas').createCanvas
  let loadImage: typeof import('@napi-rs/canvas').loadImage
  try {
    ;({ createCanvas, loadImage } = await import('@napi-rs/canvas'))
  } catch (error) {
    log.warn('Canvas-Bibliothek nicht verfügbar – Bildminiatur entfällt.', error)
    return null
  }

  const image = await loadImage(buffer)
  const { width, height } = containSize(image.width, image.height, THUMB_WIDTH, THUMB_HEIGHT)
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(image, 0, 0, width, height)
  return canvas.toBuffer('image/png')
}

function containSize(
  srcW: number,
  srcH: number,
  maxW: number,
  maxH: number,
): { width: number; height: number } {
  const scale = Math.min(maxW / srcW, maxH / srcH, 1)
  return {
    width: Math.max(1, Math.round(srcW * scale)),
    height: Math.max(1, Math.round(srcH * scale)),
  }
}

/** Stellt sicher, dass das Miniaturverzeichnis existiert (Bootstrap). */
export async function ensureThumbRoot(): Promise<void> {
  await mkdir(join(uploadRoot(), '.thumbs'), { recursive: true })
}

export async function thumbnailFileStat(assetId: string) {
  try {
    return await stat(resolveStoragePath(thumbnailStorageKey(assetId)))
  } catch {
    return null
  }
}
