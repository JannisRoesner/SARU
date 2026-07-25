import { createLogger } from '../../utils/logger'

const log = createLogger('ai:rasterize')

export interface RasterizedPage {
  pageNumber: number
  mimeType: 'image/png'
  base64: string
}

/**
 * Rendert die ersten Seiten eines PDFs als PNG.
 * Wird nur benötigt, wenn der KI-Anbieter keine PDFs direkt entgegennimmt
 * (z. B. lokale Ollama-Modelle). Schlägt das Rendern fehl, greift der Aufrufer
 * auf die reine Textextraktion zurück.
 */
export async function rasterizePdf(
  buffer: Buffer,
  options: { maxPages?: number; scale?: number } = {},
): Promise<RasterizedPage[]> {
  const maxPages = options.maxPages ?? 8
  const scale = options.scale ?? 1.6

  let createCanvas: typeof import('@napi-rs/canvas').createCanvas
  try {
    ;({ createCanvas } = await import('@napi-rs/canvas'))
  } catch (error) {
    log.warn('Canvas-Bibliothek nicht verfügbar – PDF wird nicht als Bild übergeben.', error)
    return []
  }

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: false,
    verbosity: 0,
  })

  try {
    const document = await task.promise
    const pages: RasterizedPage[] = []
    const pageCount = Math.min(document.numPages, maxPages)

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
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
