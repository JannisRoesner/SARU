import { createHash } from 'node:crypto'
import { loadPdfjs } from '../../../utils/pdfjs'
import type { SolutionBBox } from '../document-fill'
import type { LayoutDocumentV2, LayoutTextSpan } from './types'

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function normalizedBBox(
  x: number,
  baselineY: number,
  width: number,
  height: number,
  pageWidth: number,
  pageHeight: number,
): SolutionBBox {
  const normalizedHeight = Math.max(0.004, height / pageHeight)
  return {
    x: clamp(x / pageWidth),
    y: clamp(1 - baselineY / pageHeight - normalizedHeight),
    w: clamp(Math.max(1, width) / pageWidth),
    h: normalizedHeight,
  }
}

export async function buildPdfLayoutDocumentV2(
  source: Buffer,
  fallbackText = '',
): Promise<LayoutDocumentV2> {
  const pdfjs = await loadPdfjs()
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(source),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  })
  const pages: LayoutDocumentV2['pages'] = []
  const pageTexts: string[] = []

  try {
    const pdf = await loadingTask.promise
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const spans: LayoutTextSpan[] = []
      for (const [index, item] of content.items.entries()) {
        if (!('str' in item) || typeof item.str !== 'string' || !item.str.trim()) continue
        if (!('transform' in item) || !item.transform) continue
        const x = item.transform[4] ?? 0
        const baselineY = item.transform[5] ?? 0
        const fontHeight = Math.abs(item.transform[3] ?? item.height ?? 10)
        const width = Number(item.width ?? 1)
        spans.push({
          id: `p${pageNumber}-text-${index}`,
          page: pageNumber,
          text: item.str,
          bbox: normalizedBBox(
            x,
            baselineY,
            width,
            fontHeight,
            viewport.width,
            viewport.height,
          ),
        })
      }
      const pageText = spans.map((span) => span.text).join(' ').replace(/\s+/g, ' ').trim()
      pageTexts.push(pageText)
      pages.push({
        page: pageNumber,
        width: viewport.width,
        height: viewport.height,
        textSpans: spans,
        extractionQuality: spans.length > 0 ? 'text_layer' : 'empty',
      })
      page.cleanup()
    }
  } finally {
    await loadingTask.destroy()
  }

  return {
    schemaVersion: 2,
    sourceHash: createHash('sha256').update(source).digest('hex'),
    pages,
    fullText: pageTexts.some(Boolean) ? pageTexts.join('\n\n') : fallbackText.trim(),
  }
}

export function buildTextOnlyLayoutDocumentV2(
  text: string,
  source: Buffer | string,
): LayoutDocumentV2 {
  const hash = createHash('sha256').update(source).digest('hex')
  return {
    schemaVersion: 2,
    sourceHash: hash,
    pages: [
      {
        page: 1,
        width: 595,
        height: 842,
        textSpans: text.trim()
          ? [{ id: 'p1-text-0', page: 1, text: text.trim(), bbox: { x: 0, y: 0, w: 1, h: 1 } }]
          : [],
        extractionQuality: text.trim() ? 'text_layer' : 'empty',
      },
    ],
    fullText: text.trim(),
  }
}

function overlapsVertically(a: SolutionBBox, b: SolutionBBox, margin: number): boolean {
  const aBottom = a.y + (a.h ?? 0.02)
  const bBottom = b.y + (b.h ?? 0.02)
  return a.y - margin <= bBottom && b.y - margin <= aBottom
}

/** Liefert lesbaren Zeilen-/Spaltenkontext um ein Ziel statt nur dessen Index. */
export function nearbyTextForTarget(
  document: LayoutDocumentV2,
  page: number,
  bbox: SolutionBBox | null | undefined,
): string {
  if (!bbox) return ''
  const spans = document.pages.find((candidate) => candidate.page === page)?.textSpans ?? []
  const sameRow = spans.filter(
    (span) =>
      overlapsVertically(span.bbox, bbox, 0.025) &&
      span.bbox.x <= bbox.x + (bbox.w ?? 0.05) + 0.08,
  )
  const header = spans.filter(
    (span) =>
      span.bbox.y < bbox.y &&
      bbox.y - (span.bbox.y + (span.bbox.h ?? 0.02)) < 0.18 &&
      Math.abs(span.bbox.x - bbox.x) < Math.max(0.08, bbox.w ?? 0.05),
  )
  return [...header, ...sameRow]
    .sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)
    .map((span) => span.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 600)
}

/**
 * Rekonstruiert die konkrete Textzeile um ein geometrisches Ziel und setzt an
 * dessen Position einen sichtbaren Lückenmarker. Das ist besonders wichtig für
 * rein grafische PDF-Linien, die selbst keinen leftText/rightText-Kontext haben.
 */
export function markedRowContextForTarget(
  document: LayoutDocumentV2,
  page: number,
  bbox: SolutionBBox | null | undefined,
): string {
  if (!bbox) return ''
  const spans = document.pages.find((candidate) => candidate.page === page)?.textSpans ?? []
  const targetLeft = bbox.x
  const targetRight = bbox.x + (bbox.w ?? 0.05)
  const row = spans
    .filter((span) => overlapsVertically(span.bbox, bbox, 0.018))
    .sort((a, b) => a.bbox.x - b.bbox.x)
  const left = row
    .filter((span) => span.bbox.x + (span.bbox.w ?? 0) <= targetLeft + 0.015)
    .map((span) => span.text.trim())
    .filter(Boolean)
    .join(' ')
  const right = row
    .filter((span) => span.bbox.x >= targetRight - 0.015)
    .map((span) => span.text.trim())
    .filter(Boolean)
    .join(' ')
  if (!left && !right) return ''
  return `${left} ___ ${right}`.replace(/\s+/g, ' ').trim().slice(0, 600)
}
