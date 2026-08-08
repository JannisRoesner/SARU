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

interface PdfTableGrid {
  pageIndex: number
  columns: Array<{ x: number; width: number }>
  yLevels: number[]
  lines: Set<PdfAnswerLineRaw>
}

interface PdfTextItem {
  str: string
  transform: ArrayLike<number>
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

interface PdfDiagramLeader {
  outerX: number
  outerY: number
  side: 'left' | 'right'
}

interface PdfDiagramSegment {
  start: [number, number]
  end: [number, number]
}

/**
 * Erkennt einfache Beschriftungslinien eines Diagramms direkt aus dem
 * PDF-Vektorstrom. Die Heuristik ist bewusst konservativ: Sie liefert nur
 * Ziele, wenn exakt die erwartete Anzahl kurzer, schräger Einzelsegmente in
 * einem gemeinsamen vertikalen Diagrammband gefunden wird.
 */
export async function detectPdfDiagramLabelTargets(
  source: Buffer,
  options: { page: number; expectedCount: number },
): Promise<AnswerTarget[]> {
  if (options.page < 1 || options.expectedCount < 2 || options.expectedCount > 20) return []

  const pdfjs = await loadPdfjs()
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(source),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  })

  try {
    const document = await loadingTask.promise
    if (options.page > document.numPages) return []
    const page = await document.getPage(options.page)
    const viewport = page.getViewport({ scale: 1 })
    const opList = await page.getOperatorList()
    const segments: PdfDiagramSegment[] = []
    let matrix: PdfMatrix = [...IDENTITY_MATRIX]
    const matrixStack: PdfMatrix[] = []

    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i]!
      const args = opList.argsArray[i]
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
      if (fn !== pdfjs.OPS.constructPath) continue

      const pathArgs = Array.isArray(args) ? args : []
      const paintOperation = pathArgs[0]
      const isStroked =
        paintOperation === pdfjs.OPS.stroke ||
        paintOperation === pdfjs.OPS.closeStroke ||
        paintOperation === pdfjs.OPS.fillStroke ||
        paintOperation === pdfjs.OPS.eoFillStroke
      if (!isStroked) continue

      const groups = Array.isArray(pathArgs[1]) ? pathArgs[1] : []
      if (groups.length !== 1) continue
      const path = asNumberArray(groups[0])
      // pdf.js: [moveTo, x0, y0, lineTo, x1, y1]
      if (!path || path.length !== 6 || path[0] !== 0 || path[3] !== 1) continue
      const start = transformPoint(matrix, path[1]!, path[2]!)
      const end = transformPoint(matrix, path[4]!, path[5]!)
      const dx = end[0] - start[0]
      const dy = end[1] - start[1]
      const length = Math.hypot(dx, dy)
      if (length < 35 || length > 140 || Math.abs(dx) < 30 || Math.abs(dy) < 4) continue

      segments.push({ start, end })
    }
    page.cleanup()

    if (segments.length !== options.expectedCount) return []
    const endpointXs = segments
      .flatMap((segment) => [segment.start[0], segment.end[0]])
      .sort((a, b) => a - b)
    const centerX = endpointXs[Math.floor(endpointXs.length / 2)] ?? viewport.width / 2
    const leaders: PdfDiagramLeader[] = segments.map((segment) => {
      const outer = Math.abs(segment.start[0] - centerX) >= Math.abs(segment.end[0] - centerX)
        ? segment.start
        : segment.end
      return {
        outerX: outer[0],
        outerY: outer[1],
        side: outer[0] < centerX ? 'left' : 'right',
      }
    })
    if (!leaders.some((leader) => leader.side === 'left') || !leaders.some((leader) => leader.side === 'right')) {
      return []
    }
    const ys = leaders.map((leader) => leader.outerY)
    if (Math.max(...ys) - Math.min(...ys) > viewport.height * 0.22) return []

    const sideRank = new Map<PdfDiagramLeader, number>()
    for (const side of ['left', 'right'] as const) {
      [...leaders]
        .filter((leader) => leader.side === side)
        .sort((a, b) => b.outerY - a.outerY)
        .forEach((leader, index) => sideRank.set(leader, index + 1))
    }

    return [...leaders]
      .sort((a, b) => b.outerY - a.outerY || a.outerX - b.outerX)
      .map((leader, index) => {
        const outerX = leader.outerX / viewport.width
        const x = leader.side === 'left'
          ? Math.max(0.04, outerX - 0.2)
          : Math.max(0.04, outerX - 0.01)
        const right = leader.side === 'left'
          ? Math.min(0.96, outerX + 0.01)
          : Math.min(0.96, outerX + 0.28)
        return {
          id: `pdf-diagram-leader-p${options.page}-${index + 1}`,
          kind: 'shape_box' as const,
          page: options.page,
          bbox: {
            x,
            y: Math.max(0, 1 - leader.outerY / viewport.height - 0.018),
            w: Math.max(0.04, right - x),
            h: 0.036,
          },
          leftText: `Beschriftungsziel ${leader.side} ${sideRank.get(leader) ?? index + 1}`,
          source: 'native' as const,
        }
      })
  } finally {
    await loadingTask.destroy()
  }
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

function groupLinesByY(lines: PdfAnswerLineRaw[]): PdfAnswerLineRaw[][] {
  const groups: PdfAnswerLineRaw[][] = []
  for (const line of [...lines].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const group = groups.find(
      (candidate) =>
        candidate[0]!.pageIndex === line.pageIndex &&
        Math.abs(candidate[0]!.y - line.y) <= 2.5,
    )
    if (group) group.push(line)
    else groups.push([line])
  }
  return groups
}

function sameColumnSignature(a: PdfAnswerLineRaw[], b: PdfAnswerLineRaw[]): boolean {
  if (a.length < 3 || a.length !== b.length) return false
  const left = [...a].sort((x, y) => x.x - y.x)
  const right = [...b].sort((x, y) => x.x - y.x)
  return left.every(
    (line, index) =>
      Math.abs(line.x - right[index]!.x) <= 3 &&
      Math.abs(line.width - right[index]!.width) <= 4,
  )
}

/**
 * Erkennt Tabellen, deren Zellränder als getrennte horizontale Liniensegmente
 * gezeichnet sind. Das ist absichtlich strenger als die Antwortlinien-Erkennung:
 * mindestens drei gleich ausgerichtete Spalten und drei horizontale Rasterebenen
 * verhindern, dass normale Schreiblinien als Tabelle klassifiziert werden.
 */
function detectTableGrids(lines: PdfAnswerLineRaw[]): PdfTableGrid[] {
  const grids: PdfTableGrid[] = []
  const groups = groupLinesByY(lines)

  for (const seed of groups) {
    const matching = groups.filter(
      (candidate) =>
        candidate[0]!.pageIndex === seed[0]!.pageIndex &&
        sameColumnSignature(seed, candidate),
    )
    if (matching.length < 3) continue

    const yLevels = matching
      .map((group) => group.reduce((sum, line) => sum + line.y, 0) / group.length)
      .sort((a, b) => b - a)
    const existing = grids.some(
      (grid) =>
        grid.pageIndex === seed[0]!.pageIndex &&
        Math.abs(grid.yLevels[0]! - yLevels[0]!) <= 3 &&
        Math.abs(grid.yLevels.at(-1)! - yLevels.at(-1)!) <= 3,
    )
    if (existing) continue

    const columns = [...seed]
      .sort((a, b) => a.x - b.x)
      .map((line) => ({ x: line.x, width: line.width }))
    grids.push({
      pageIndex: seed[0]!.pageIndex,
      columns,
      yLevels,
      lines: new Set(matching.flat()),
    })
  }
  return grids
}

async function extractPdfTextPositions(source: Buffer): Promise<PdfTextItem[][]> {
  const pdfjs = await loadPdfjs()
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(source),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  })
  try {
    const document = await loadingTask.promise
    const pages: PdfTextItem[][] = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(
        content.items
          .flatMap((item) => {
            if (
              !('str' in item) ||
              typeof item.str !== 'string' ||
              !('transform' in item) ||
              !item.transform
            ) {
              return []
            }
            return item.str.trim().length > 0
              ? [{ str: item.str, transform: item.transform }]
              : []
          }),
      )
      page.cleanup()
    }
    return pages
  } finally {
    await loadingTask.destroy()
  }
}

function cellHasText(
  items: PdfTextItem[],
  column: { x: number; width: number },
  upperY: number,
  lowerY: number,
): boolean {
  return items.some((item) => {
    const x = item.transform[4] ?? Number.NaN
    const y = item.transform[5] ?? Number.NaN
    return (
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      x >= column.x + 2 &&
      x <= column.x + column.width - 2 &&
      y >= lowerY + 2 &&
      y <= upperY - 2
    )
  })
}

function textInCell(
  items: PdfTextItem[],
  column: { x: number; width: number },
  upperY: number,
  lowerY: number,
): string {
  return items
    .filter((item) => {
      const x = item.transform[4] ?? Number.NaN
      const y = item.transform[5] ?? Number.NaN
      return (
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        x >= column.x + 2 &&
        x <= column.x + column.width - 2 &&
        y >= lowerY + 2 &&
        y <= upperY - 2
      )
    })
    .map((item) => item.str)
    .join(' ')
}

function choiceValueFromHeader(text: string): string | null {
  const normalized = text.toLocaleLowerCase('de-DE').replace(/\s+/g, ' ').trim()
  if (/\brichtig\b/.test(normalized)) return 'richtig'
  if (/\bfalsch\b/.test(normalized)) return 'falsch'
  if (/\bja\b/.test(normalized)) return 'ja'
  if (/\bnein\b/.test(normalized)) return 'nein'
  return null
}

export async function detectPdfTableCells(source: Buffer): Promise<{
  targets: AnswerTarget[]
  consumedLines: Set<PdfAnswerLineRaw>
}> {
  const { lines, pageSizes } = await extractPdfHorizontalStrokes(source)
  return detectPdfTableCellsFromStrokes(source, lines, pageSizes)
}

async function detectPdfTableCellsFromStrokes(
  source: Buffer,
  lines: PdfAnswerLineRaw[],
  pageSizes: PageSize[],
): Promise<{ targets: AnswerTarget[]; consumedLines: Set<PdfAnswerLineRaw> }> {
  const grids = detectTableGrids(lines)
  if (grids.length === 0) return { targets: [], consumedLines: new Set() }

  const textPages = await extractPdfTextPositions(source)
  const targets: AnswerTarget[] = []
  const consumedLines = new Set<PdfAnswerLineRaw>()
  let index = 0

  for (const grid of grids) {
    const page = pageSizes[grid.pageIndex]
    if (!page) continue
    for (const line of grid.lines) consumedLines.add(line)
    const items = textPages[grid.pageIndex] ?? []
    const headerTop = grid.yLevels[0]!
    const headerBottom = grid.yLevels[1]!
    const choiceColumns = new Map<number, string>()
    for (let col = 0; col < grid.columns.length; col++) {
      const value = choiceValueFromHeader(
        textInCell(items, grid.columns[col]!, headerTop, headerBottom),
      )
      if (value) choiceColumns.set(col, value)
    }
    const pageText = items.map((item) => item.str).join(' ')
    const hasChoiceColumns = choiceColumns.size >= 2
    const isChoiceTable =
      hasChoiceColumns && /\b(?:kreuz\w*|ankreuz\w*|markier\w*)\b/i.test(pageText)
    const choiceCellsAreEmpty =
      !hasChoiceColumns ||
      Array.from({ length: grid.yLevels.length - 2 }, (_, rowOffset) =>
        [...choiceColumns.keys()].every((col) => {
          const row = rowOffset + 1
          return !cellHasText(
            items,
            grid.columns[col]!,
            grid.yLevels[row]!,
            grid.yLevels[row + 1]!,
          )
        }),
      ).every(Boolean)
    // Erste Zeile enthält typischerweise die Spaltenüberschriften. Datenzeilen
    // werden nur dann zu Zielen, wenn in der konkreten Zelle kein Text steht.
    for (let row = 1; row < grid.yLevels.length - 1; row++) {
      const upperY = grid.yLevels[row]!
      const lowerY = grid.yLevels[row + 1]!
      if (upperY - lowerY < 18) continue
      for (let col = 0; col < grid.columns.length; col++) {
        const column = grid.columns[col]!
        const choiceValue = choiceColumns.get(col)
        // Bereits angekreuzte Kontroll-/Lösungsblätter sind keine neue Aufgabe.
        // Kontrollblätter enthalten bereits je Zeile ein X. Diese Seite ist
        // keine neue, teilweise leere Tabellenaufgabe.
        if (hasChoiceColumns && choiceValue && !choiceCellsAreEmpty) continue
        if (cellHasText(items, column, upperY, lowerY)) continue
        const insetX = Math.min(4, column.width * 0.08)
        const insetY = Math.min(4, (upperY - lowerY) * 0.12)
        const isChoiceCell = Boolean(isChoiceTable && choiceValue)
        const markWidth = Math.min(18, Math.max(12, column.width * 0.28))
        targets.push({
          id: `pdf-table-${index}`,
          kind: isChoiceCell ? 'choice_cell' : 'table_cell',
          page: grid.pageIndex + 1,
          blankIndex: index,
          cellRef: `${grid.pageIndex}:${row}:${col}`,
          choiceValue: choiceValue ?? null,
          bbox: {
            x: isChoiceCell
              ? (column.x + (column.width - markWidth) / 2) / page.width
              : (column.x + insetX) / page.width,
            y: 1 - (upperY - insetY) / page.height,
            w: isChoiceCell
              ? markWidth / page.width
              : Math.max(0.03, (column.width - insetX * 2) / page.width),
            h: Math.max(0.025, (upperY - lowerY - insetY * 2) / page.height),
          },
          source: 'native',
        })
        index += 1
      }
    }
  }
  return { targets, consumedLines }
}

/** Erkennt PDF-Tabellenzellen und normale Antwortlinien in einem Durchlauf. */
export async function detectPdfLayoutTargets(source: Buffer): Promise<{
  tableTargets: AnswerTarget[]
  lineTargets: AnswerTarget[]
  shapes: ShapeBlock[]
  rawLineCount: number
  clusterCount: number
}> {
  const { lines, pageSizes } = await extractPdfHorizontalStrokes(source)
  const table = await detectPdfTableCellsFromStrokes(source, lines, pageSizes)
  const remainingLines = lines.filter((line) => !table.consumedLines.has(line))
  const clusters = clusterPdfAnswerLines(remainingLines, pageSizes)
  return {
    tableTargets: table.targets,
    lineTargets: pdfAnswerLinesToAnswerTargets(clusters),
    shapes: pdfAnswerLinesToShapeBlocks(clusters),
    rawLineCount: remainingLines.length,
    clusterCount: clusters.length,
  }
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
