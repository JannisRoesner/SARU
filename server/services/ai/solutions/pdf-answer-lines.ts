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
const MAX_REPEATED_LINE_PAGE_FRACTION = 0.94
const MAX_LINE_SLOPE_PT = 2.5
const MAX_RECT_HEIGHT_PT = 2.5
const CLUSTER_MAX_DY_PT = 24
const CLUSTER_MAX_DX_PT = 18
const HEADER_FOOTER_BAND = 0.06
const WIDE_LINE_PEER_MAX_DY_PT = 30

interface PageSize {
  width: number
  height: number
}

type PdfMatrix = [number, number, number, number, number, number]

const IDENTITY_MATRIX: PdfMatrix = [1, 0, 0, 1, 0, 0]

function multiplyMatrices(current: PdfMatrix, next: PdfMatrix): PdfMatrix {
  const [a1, b1, c1, d1, e1, f1] = current
  const [a2, b2, c2, d2, e2, f2] = next
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]
}

function transformPoint(matrix: PdfMatrix, x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = matrix
  return [a * x + c * y + e, b * x + d * y + f]
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
  if (width > page.width * MAX_REPEATED_LINE_PAGE_FRACTION) return
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

function filterDecorativeWideLines(
  lines: PdfAnswerLineRaw[],
  pageSizes: PageSize[],
): PdfAnswerLineRaw[] {
  return lines.filter((line, index) => {
    const page = pageSizes[line.pageIndex]
    if (!page || line.width <= page.width * MAX_LINE_PAGE_FRACTION) return true

    return lines.some((candidate, candidateIndex) => {
      if (candidateIndex === index || candidate.pageIndex !== line.pageIndex) return false
      const dy = Math.abs(candidate.y - line.y)
      return (
        dy > 0.5 &&
        dy <= WIDE_LINE_PEER_MAX_DY_PT &&
        Math.abs(candidate.x - line.x) <= CLUSTER_MAX_DX_PT &&
        Math.abs(candidate.width - line.width) <= Math.max(24, line.width * 0.1)
      )
    })
  })
}

function asNumberArray(value: unknown): number[] | null {
  if (!value) return null
  if (Array.isArray(value) && value.every((n) => typeof n === 'number')) {
    return value as number[]
  }
  if (
    ArrayBuffer.isView(value) &&
    typeof (value as unknown as ArrayLike<number>).length === 'number'
  ) {
    return Array.from(value as unknown as ArrayLike<number>)
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
      let matrix: PdfMatrix = [...IDENTITY_MATRIX]
      const matrixStack: PdfMatrix[] = []

      for (let i = 0; i < fnArray.length; i++) {
        const fn = fnArray[i]!
        const args = argsArray[i]

        if (fn === pdfjs.OPS.save) {
          matrixStack.push([...matrix])
          continue
        }

        if (fn === pdfjs.OPS.restore) {
          matrix = matrixStack.pop() ?? [...IDENTITY_MATRIX]
          continue
        }

        if (fn === pdfjs.OPS.transform) {
          const values = asNumberArray(args)
          if (values && values.length >= 6) {
            matrix = multiplyMatrices(matrix, values.slice(0, 6) as PdfMatrix)
          }
          continue
        }

        if (fn === pdfjs.OPS.constructPath) {
          const pathArgs = Array.isArray(args) ? args : []
          const paintOperation = pathArgs[0]
          const isStroked =
            paintOperation === pdfjs.OPS.stroke ||
            paintOperation === pdfjs.OPS.closeStroke ||
            paintOperation === pdfjs.OPS.fillStroke ||
            paintOperation === pdfjs.OPS.eoFillStroke
          if (!isStroked) continue

          // pdf.js 6 liefert [paintOp, [pathOps], minMax]. Die minMax-Werte
          // liegen vor der aktuellen Transformationsmatrix im lokalen User-Space.
          const points = asNumberArray(pathArgs[2])
          if (points && points.length >= 4) {
            const [a, b, c, d] = points
            if (
              Number.isFinite(a) &&
              Number.isFinite(b) &&
              Number.isFinite(c) &&
              Number.isFinite(d) &&
              Math.abs(d! - b!) <= MAX_LINE_SLOPE_PT
            ) {
              const start = transformPoint(matrix, a!, b!)
              const end = transformPoint(matrix, c!, d!)
              pushLine(
                lines,
                pageNumber - 1,
                pageSize,
                start[0],
                start[1],
                end[0],
                end[1],
              )
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
            const start = transformPoint(matrix, penX, penY)
            const end = transformPoint(matrix, pts[0]!, pts[1]!)
            pushLine(
              lines,
              pageNumber - 1,
              pageSize,
              start[0],
              start[1],
              end[0],
              end[1],
            )
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
              const start = transformPoint(matrix, rx!, ry! + rh! / 2)
              const end = transformPoint(matrix, rx! + rw!, ry! + rh! / 2)
              pushLine(
                lines,
                pageNumber - 1,
                pageSize,
                start[0],
                start[1],
                end[0],
                end[1],
              )
            }
          }
        }
      }

      page.cleanup()
    }

    return { lines: filterDecorativeWideLines(lines, pageSizes), pageSizes }
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
