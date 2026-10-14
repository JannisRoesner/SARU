import { readFile } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import { isOfficeFile } from '#shared/utils/office-files'
import { useDatabase } from '../../database/client'
import { materialAssets } from '../../database/schema'
import { createLogger } from '../../utils/logger'
import type { EmbeddingImage } from '../ai/client'
import { getPdfPageCount, rasterizePdf } from '../ai/rasterize'
import { convertOfficeFileToPdf } from '../office-convert.service'
import { fileExists, resolveStoragePath } from '../storage.service'

/**
 * Seitenbilder für die multimodale Vektorsuche: Arbeitsblätter enthalten oft
 * Abbildungen, Diagramme oder Scans, deren Inhalt im extrahierten Text fehlt.
 */

const log = createLogger('search:seitenbilder')

/** Längste Bildkante – das Modell skaliert ohnehin herunter, größere Bilder kosten nur Übertragung. */
const MAX_KANTE = 1024
/** A4 bei Faktor 1,25 ergibt etwa 744 × 1052 Pixel. */
const PDF_SCALE = 1.25
const JPEG_QUALITAET = 85

export interface BildQuelle {
  kind: string
  storageKey: string | null
  mimeType: string | null
  fileName: string | null
}

type Art = 'pdf' | 'bild' | 'office'

function art(asset: BildQuelle): Art | null {
  if (asset.kind !== 'datei' || !asset.storageKey) return null
  if (asset.mimeType === 'application/pdf' || (asset.fileName ?? '').toLowerCase().endsWith('.pdf')) {
    return 'pdf'
  }
  if (asset.mimeType?.startsWith('image/') && asset.mimeType !== 'image/svg+xml') return 'bild'
  if (isOfficeFile(asset.fileName, asset.mimeType)) return 'office'
  return null
}

export function hatSeitenbilder(asset: BildQuelle): boolean {
  return art(asset) !== null
}

async function alsPdf(asset: BildQuelle, typ: 'pdf' | 'office'): Promise<Buffer | null> {
  const pfad = resolveStoragePath(asset.storageKey!)
  return typ === 'pdf' ? readFile(pfad) : convertOfficeFileToPdf(pfad)
}

/**
 * Seitenzahl einer Datei. Für PDFs und Office-Dateien wird sie beim ersten Mal
 * ermittelt und am Anhang gespeichert, damit Neuindizierungen nicht erneut
 * konvertieren müssen.
 */
export async function seitenzahl(
  assetId: string,
  asset: BildQuelle & { pageCount: number | null },
): Promise<number> {
  const typ = art(asset)
  if (!typ) return 0
  if (typ === 'bild') return 1
  if (asset.pageCount && asset.pageCount > 0) return asset.pageCount
  if (!(await fileExists(asset.storageKey!))) return 0

  try {
    const pdf = await alsPdf(asset, typ)
    const anzahl = pdf ? await getPdfPageCount(pdf) : null
    if (!anzahl) return 0
    await useDatabase()
      .update(materialAssets)
      .set({ pageCount: anzahl })
      .where(eq(materialAssets.id, assetId))
    return anzahl
  } catch (error) {
    log.warn('Seitenzahl konnte nicht ermittelt werden', { assetId, error })
    return 0
  }
}

async function alsJpeg(png: Buffer): Promise<EmbeddingImage> {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas')
  const bild = await loadImage(png)
  const faktor = Math.min(1, MAX_KANTE / Math.max(bild.width, bild.height))
  const breite = Math.max(1, Math.round(bild.width * faktor))
  const hoehe = Math.max(1, Math.round(bild.height * faktor))
  const canvas = createCanvas(breite, hoehe)
  const ctx = canvas.getContext('2d')
  // Transparente Flächen (PNG-Grafiken) auf Weiß statt Schwarz.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, breite, hoehe)
  ctx.drawImage(bild, 0, 0, breite, hoehe)
  return {
    type: 'image',
    mimeType: 'image/jpeg',
    base64: canvas.toBuffer('image/jpeg', JPEG_QUALITAET).toString('base64'),
  }
}

/**
 * Rendert die gewünschten Seiten einer Datei. Fehlende Seiten (Datei gelöscht,
 * nicht lesbar) fehlen in der Rückgabe.
 */
export async function seitenRendern(assetId: string, seiten: number[]): Promise<Map<number, EmbeddingImage>> {
  const ergebnis = new Map<number, EmbeddingImage>()

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

  const typ = asset ? art(asset) : null
  if (!asset || !typ || !(await fileExists(asset.storageKey!))) return ergebnis

  try {
    if (typ === 'bild') {
      if (seiten.includes(1)) {
        ergebnis.set(1, await alsJpeg(await readFile(resolveStoragePath(asset.storageKey!))))
      }
      return ergebnis
    }

    const pdf = await alsPdf(asset, typ)
    if (!pdf) return ergebnis
    for (const seite of await rasterizePdf(pdf, { pages: seiten, scale: PDF_SCALE })) {
      ergebnis.set(seite.pageNumber, await alsJpeg(Buffer.from(seite.base64, 'base64')))
    }
  } catch (error) {
    log.warn('Seitenbilder konnten nicht gerendert werden', { assetId, error })
  }
  return ergebnis
}
