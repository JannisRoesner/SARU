import { createLogger } from '../../utils/logger'
import { loadPdfjs, pdfjsAssetUrl } from '../../utils/pdfjs'

const log = createLogger('ai:rasterize')

export interface RasterizedPage {
  pageNumber: number
  mimeType: 'image/png'
  base64: string
}

/**
 * Rendert PDF-Seiten als PNG.
 * Wird u. a. für Vision-Prompts und die visuelle Nachbearbeitung von Overlay-Lösungen genutzt.
 */
export async function rasterizePdf(
  buffer: Buffer,
  options: {
    maxPages?: number
    scale?: number
    /** Nur diese 1-basierte Seite rendern. */
    page?: number
  } = {},
): Promise<RasterizedPage[]> {
  const maxPages = options.maxPages ?? 8
  const scale = options.scale ?? 1.6
  const onlyPage = options.page && options.page > 0 ? Math.floor(options.page) : null

  let createCanvas: typeof import('@napi-rs/canvas').createCanvas
  try {
    ;({ createCanvas } = await import('@napi-rs/canvas'))
  } catch (error) {
    log.warn('Canvas-Bibliothek nicht verfügbar – PDF wird nicht als Bild übergeben.', error)
    return []
  }

  const pdfjs = await loadPdfjs()
  // In Node gibt es keine FontFace-API: disableFontFace:false lädt OTF via @font-face
  // und rendert Glyphs als □. Stattdessen den eingebauten Pfad-Renderer nutzen und
  // Standardschriften/CMaps aus dem pdfjs-dist-Paket laden.
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: pdfjsAssetUrl('standard_fonts'),
    cMapUrl: pdfjsAssetUrl('cmaps'),
    cMapPacked: true,
    wasmUrl: pdfjsAssetUrl('wasm'),
    verbosity: 0,
  })

  try {
    const document = await task.promise
    const pages: RasterizedPage[] = []

    const start = onlyPage ?? 1
    const end = onlyPage
      ? Math.min(onlyPage, document.numPages)
      : Math.min(document.numPages, maxPages)

    if (onlyPage && onlyPage > document.numPages) return []

    for (let pageNumber = start; pageNumber <= end; pageNumber++) {
      const page = await document.getPage(pageNumber)
      const viewport = page.getViewport({ scale })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      const context = canvas.getContext('2d')

      // Weißer Hintergrund, sonst wird transparenter PDF-Grund schwarz gerendert.
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)

      // pdf.js erwartet die DOM-Canvas-Typen; @napi-rs/canvas ist API-kompatibel,
      // deklariert aber eigene Typen.
      await page.render({
        canvas: canvas as never,
        canvasContext: context as never,
        viewport,
      }).promise
      page.cleanup()

      pages.push({
        pageNumber,
        mimeType: 'image/png',
        base64: canvas.toBuffer('image/png').toString('base64'),
      })
    }

    return pages
  } catch (error) {
    log.warn('PDF konnte nicht in Bilder umgewandelt werden', error)
    return []
  } finally {
    await task.destroy()
  }
}

/** Seitenzahl ohne Rendering – für PDF-Vorschau-Navigation. */
export async function getPdfPageCount(buffer: Buffer): Promise<number | null> {
  try {
    const pdfjs = await loadPdfjs()
    const task = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableFontFace: true,
      useSystemFonts: false,
      standardFontDataUrl: pdfjsAssetUrl('standard_fonts'),
      cMapUrl: pdfjsAssetUrl('cmaps'),
      cMapPacked: true,
      wasmUrl: pdfjsAssetUrl('wasm'),
      verbosity: 0,
    })
    const document = await task.promise
    const count = document.numPages
    await document.destroy()
    return count > 0 ? count : null
  } catch (error) {
    log.warn('PDF-Seitenzahl konnte nicht ermittelt werden', error)
    return null
  }
}
