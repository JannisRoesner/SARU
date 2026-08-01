import type { SolutionBBox } from '../document-fill'
import { loadPdfjs } from '../../../utils/pdfjs'
import type { AnswerTarget, ShapeBlock } from './types'

/** Einzelne gestrichelte Horizontallinie in PDF-User-Space (Ursprung unten links). */
export interface PdfAnswerLineRaw {
  pageIndex: number
  x: number
  y: number
  width: number
  height: number
}

export interface PdfAnswerLineTarget {
  id: string
  page: number
  bbox: SolutionBBox
  /** Anzahl zusammengefasster Linien in diesem Schreibblock. */
  lineCount: number
  leftText?: string
}

const MIN_LINE_WIDTH_PT = 48
const MAX_LINE_PAGE_FRACTION = 0.72
const MAX_LINE_SLOPE_PT = 2.5
const MAX_RECT_HEIGHT_PT = 2.5
const CLUSTER_MAX_DY_PT = 22
const CLUSTER_MAX_DX_PT = 18
const HEADER_FOOTER_BAND = 0.06

interface PageSize {
  width: number
  height: number
}

function isNearHorizontal(x0: number, y0: number, x1: number, y1: number): boolean {
  const width = Math.abs(x1 - x0)
  const height = Math.abs(y1 - y0)
  return width >= MIN_LINE_WIDTH_PT && height <= MAX_LINE_SLOPE_PT
}

function pushLine(
  out: PdfAnswerLineRaw[],
  pageIndex: number,
  page: PageSize,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  if (!isNearHorizontal(x0, y0, x1, y1)) return
  const x = Math.min(x0, x1)
  const y = Math.min(y0, y1)
  const width = Math.abs(x1 - x0)
  if (width > page.width * MAX_LINE_PAGE_FRACTION) return
  const yTopNorm = 1 - (y + Math.abs(y1 - y0) / 2) / page.height
  if (yTopNorm < HEADER_FOOTER_BAND || yTopNorm > 1 - HEADER_FOOTER_BAND) return
  out.push({
    pageIndex,
    x,
    y,
    width,
    height: Math.max(1, Math.abs(y1 - y0)),
  })
}

function asNumberArray(value: unknown): number[] | null {
  if (!value) return null
  if (Array.isArray(value) && value.every((n) => typeof n === 'number')) {
    return value as number[]
  }
  if (ArrayBuffer.isView(value) && typeof (value as ArrayLike<number>).length === 'number') {
    return Array.from(value as ArrayLike<number>)
  }
  return null
}

/**
 * Liest gestrichelte Horizontallinien aus dem pdf.js-Operatorstrom.
 * Nutzt constructPath (moderne pdf.js) und klassische moveTo/lineTo/stroke.
 */
export async function extractPdfHorizontalStrokes(
  source: Buffer,
): Promise<{ lines: PdfAnswerLineRaw[]; pageSizes: PageSize[] }> {
  const pdfjs = await loadPdfjs()
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(source),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  })

  try {
    const document = await loadingTask.promise
    const lines: PdfAnswerLineRaw[] = []
    const pageSizes: PageSize[] = []

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const pageSize = { width: viewport.width, height: viewport.height }
      pageSizes.push(pageSize)

      const opList = await page.getOperatorList()
      const { fnArray, argsArray } = opList
      let penX = 0
      let penY = 0

      for (let i = 0; i < fnArray.length; i++) {
        const fn = fnArray[i]!
        const args = argsArray[i]

        if (fn === pdfjs.OPS.constructPath) {
          const pathArgs = Array.isArray(args) ? args : []
          // Häufig: [strokeOp, pathData, minMaxOrPoints]
          const points =
            asNumberArray(pathArgs[2]) ??
            asNumberArray(pathArgs[1]) ??
            asNumberArray(pathArgs[0])
          if (points && points.length >= 4) {
            // Paare als Segmente lesen; bei genau 4 Werten eine Linie.
            if (points.length === 4) {
              pushLine(
                lines,
                pageNumber - 1,
                pageSize,
                points[0]!,
                points[1]!,
                points[2]!,
                points[3]!,
              )
            } else {
              for (let p = 0; p + 3 < points.length; p += 2) {
                // Nur wenn Muster wie x,y,x,y,... ohne Op-Codes
                if (points.every((n) => Number.isFinite(n))) {
                  // skip interleaved op-code streams (values like 0/1 between coords)
                }
              }
              // Robuster: wenn minMax [minX,minY,maxX,maxY] und Höhe klein → Linie
              const [a, b, c, d] = points
              if (
                Number.isFinite(a) &&
                Number.isFinite(b) &&
                Number.isFinite(c) &&
                Number.isFinite(d) &&
                Math.abs(d! - b!) <= MAX_LINE_SLOPE_PT
              ) {
                pushLine(lines, pageNumber - 1, pageSize, a!, b!, c!, d!)
              }
            }
          }
          continue
        }

        if (fn === pdfjs.OPS.moveTo) {
          const pts = asNumberArray(args)
          if (pts && pts.length >= 2) {
            penX = pts[0]!
            penY = pts[1]!
          }
          continue
        }

        if (fn === pdfjs.OPS.lineTo) {
          const pts = asNumberArray(args)
          if (pts && pts.length >= 2) {
            pushLine(lines, pageNumber - 1, pageSize, penX, penY, pts[0]!, pts[1]!)
            penX = pts[0]!
            penY = pts[1]!
          }
          continue
        }

        if (fn === pdfjs.OPS.rectangle) {
          const pts = asNumberArray(args)
          if (pts && pts.length >= 4) {
            const [rx, ry, rw, rh] = pts
            if (
              Math.abs(rh!) <= MAX_RECT_HEIGHT_PT &&
              Math.abs(rw!) >= MIN_LINE_WIDTH_PT
            ) {
              pushLine(
                lines,
                pageNumber - 1,
                pageSize,
                rx!,
                ry! + rh! / 2,
                rx! + rw!,
                ry! + rh! / 2,
              )
            }
          }
        }
      }

      page.cleanup()
    }

    return { lines, pageSizes }
  } finally {
    await loadingTask.destroy()
  }
}

/**
 * Fasst dicht untereinander liegende parallele Linien zu Schreibblöcken zusammen
 * (typisch 2–4 Antwortlinien pro Aufgabe).
 */
export function clusterPdfAnswerLines(
  lines: PdfAnswerLineRaw[],
  pageSizes: PageSize[],
): PdfAnswerLineTarget[] {
  if (lines.length === 0) return []

  const sorted = [...lines].sort((a, b) => {
    if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex
    // PDF-Y wächst nach oben → absteigend = Lesereihenfolge oben→unten
    if (Math.abs(a.y - b.y) > 1) return b.y - a.y
    return a.x - b.x
  })

  const clusters: PdfAnswerLineRaw[][] = []
  for (const line of sorted) {
    const prevCluster = clusters[clusters.length - 1]
    const prev = prevCluster?.[prevCluster.length - 1]
    if (
      prev &&
      prev.pageIndex === line.pageIndex &&
      Math.abs(prev.x - line.x) <= CLUSTER_MAX_DX_PT &&
      Math.abs(prev.width - line.width) <= Math.max(24, prev.width * 0.25) &&
      Math.abs(prev.y - line.y) > 0.5 &&
      Math.abs(prev.y - line.y) <= CLUSTER_MAX_DY_PT
    ) {
      prevCluster!.push(line)
    } else {
      clusters.push([line])
    }
  }

  // Zu wenige Einzellinien streichen, wenn sie wie Dekoration wirken:
  // behalte Cluster mit ≥1 Linie, die breit genug ist (bereits gefiltert).
  return clusters.map((cluster, index) => {
    const page = pageSizes[cluster[0]!.pageIndex] ?? { width: 595, height: 842 }
    const minX = Math.min(...cluster.map((l) => l.x))
    const maxX = Math.max(...cluster.map((l) => l.x + l.width))
    const minY = Math.min(...cluster.map((l) => l.y))
    const maxY = Math.max(...cluster.map((l) => l.y))
    // Schreibfläche leicht oberhalb der untersten Linie öffnen.
    const padTop = Math.max(12, (cluster.length - 1) * 2)
    const topPdf = maxY + padTop
    const bottomPdf = Math.max(0, minY - 2)
    const x = minX / page.width
    const w = Math.max(0.08, (maxX - minX) / page.width)
    const y = 1 - topPdf / page.height
    const h = Math.max(0.025, (topPdf - bottomPdf) / page.height)
    return {
      id: `line-${index}`,
      page: cluster[0]!.pageIndex + 1,
      bbox: {
        x: Math.min(0.95, Math.max(0, x)),
        y: Math.min(0.95, Math.max(0, y)),
        w: Math.min(0.9, w),
        h: Math.min(0.25, h),
      },
      lineCount: cluster.length,
    }
  })
}

export function pdfAnswerLinesToAnswerTargets(
  lines: PdfAnswerLineTarget[],
): AnswerTarget[] {
  return lines.map((line, index) => ({
    id: line.id,
    kind: 'answer_line' as const,
    page: line.page,
    bbox: line.bbox,
    blankIndex: index,
    leftText: line.leftText,
    source: 'native' as const,
  }))
}

export function pdfAnswerLinesToShapeBlocks(lines: PdfAnswerLineTarget[]): ShapeBlock[] {
  return lines.map((line) => ({
    id: line.id,
    page: line.page,
    kind: 'line' as const,
    bbox: line.bbox,
    nativeRef: line.id,
    anchorText: line.leftText ?? null,
  }))
}

/**
 * Erkennt grafische Antwortlinien in PDFs (z. B. Schreiblinien neben Diagrammen)
 * und fasst sie zu Overlay-Schreibblöcken zusammen.
 *
 * Wichtig: getrennt von detectPdfBlankRegions – Cloze-Unterstriche/Gaps bleiben unberührt.
 */
export async function detectPdfAnswerLines(source: Buffer): Promise<{
  targets: AnswerTarget[]
  shapes: ShapeBlock[]
  rawLineCount: number
  clusterCount: number
}> {
  const { lines, pageSizes } = await extractPdfHorizontalStrokes(source)
  const clusters = clusterPdfAnswerLines(lines, pageSizes)
  return {
    targets: pdfAnswerLinesToAnswerTargets(clusters),
    shapes: pdfAnswerLinesToShapeBlocks(clusters),
    rawLineCount: lines.length,
    clusterCount: clusters.length,
  }
}
