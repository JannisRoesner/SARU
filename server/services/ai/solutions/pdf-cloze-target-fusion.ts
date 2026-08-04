import {
  blankRegionToBBox,
  type PdfBlankRegion,
  type SolutionBBox,
} from '../document-fill'
import type { AnswerTarget, CandidateBank } from './types'

interface PageSize {
  width: number
  height: number
}

export interface PdfClozeTargetFusion {
  blanks: PdfBlankRegion[]
  consumedLineTargetIds: Set<string>
  matchedBlankCount: number
}

function center(box: SolutionBBox): { x: number; y: number } {
  return {
    x: box.x + (box.w ?? 0.02) / 2,
    y: box.y + (box.h ?? 0.02) / 2,
  }
}

function horizontalOverlapRatio(a: SolutionBBox, b: SolutionBBox): number {
  const aEnd = a.x + (a.w ?? 0.02)
  const bEnd = b.x + (b.w ?? 0.02)
  const overlap = Math.max(0, Math.min(aEnd, bEnd) - Math.max(a.x, b.x))
  return overlap / Math.max(0.001, Math.min(a.w ?? 0.02, b.w ?? 0.02))
}

function matchScore(blank: SolutionBBox, line: SolutionBBox): number | null {
  const blankCenter = center(blank)
  const lineCenter = center(line)
  const yDistance = Math.abs(blankCenter.y - lineCenter.y)
  const overlap = horizontalOverlapRatio(blank, line)
  const xDistance = Math.abs(blankCenter.x - lineCenter.x)

  if (yDistance > 0.018) return null
  if (overlap < 0.55 && xDistance > 0.025) return null
  return yDistance * 8 + xDistance * 2 + (1 - overlap)
}

function lineTargetToBlank(
  target: AnswerTarget,
  blankIndex: number,
  pageSize: PageSize,
  context?: PdfBlankRegion,
): PdfBlankRegion {
  const bbox = target.bbox!
  const height = Math.max(12, context?.height ?? (bbox.h ?? 0.025) * pageSize.height)
  const topPdf = (1 - bbox.y) * pageSize.height
  return {
    pageIndex: target.page - 1,
    blankIndex,
    x: bbox.x * pageSize.width,
    // Wenn die PDF-Textebene einen Gap erkannt hat, ist deren Baseline die
    // einzig verlässliche Ausrichtung zum umgebenden Satz. Die Liniengeometrie
    // liefert dann nur noch Breite und X-Position. Für die rein grafisch
    // erkannte Restlücke liegt die Schreib-Baseline erfahrungsgemäß etwa 2 pt
    // über der Unterkante der erkannten Linienfläche.
    y: context?.y ?? Math.max(2, topPdf - (bbox.h ?? 0.025) * pageSize.height + 4),
    width: Math.max(12, (bbox.w ?? 0.08) * pageSize.width),
    height,
    kind: 'underscore',
    leftText: context?.leftText ?? target.leftText ?? '',
    rightText: context?.rightText ?? target.rightText ?? '',
  }
}

/**
 * Führt Textlücken und grafische Unterstreichungen zu einem kanonischen
 * Lückeninventar zusammen. Die Fusion ist absichtlich konservativ:
 * - es müssen bereits mehrere Textlücken vorhanden sein,
 * - mindestens 70 % davon müssen geometrisch auf unterschiedlichen Linien liegen,
 * - die Wortliste muss genau so viele Begriffe wie Linien enthalten.
 *
 * Damit werden echte Freitext-Schreiblinien nicht pauschal als Lücken behandelt.
 */
export function fusePdfClozeTargets(args: {
  blanks: PdfBlankRegion[]
  lineTargets: AnswerTarget[]
  candidateBank: CandidateBank | null
  pageSizes: PageSize[]
}): PdfClozeTargetFusion | null {
  const { blanks, candidateBank, pageSizes } = args
  const lines = args.lineTargets
    .filter((target) => target.kind === 'answer_line' && target.bbox)
    .sort(
      (a, b) =>
        a.page - b.page ||
        (a.bbox!.y - b.bbox!.y) ||
        (a.bbox!.x - b.bbox!.x),
    )

  if (blanks.length < 2 || lines.length <= blanks.length) return null
  if (candidateBank?.candidates.length !== lines.length) return null
  if (lines.length > blanks.length + Math.max(4, Math.ceil(blanks.length * 0.5))) {
    return null
  }

  const availableLines = new Set(lines.map((line) => line.id))
  const contextByLineId = new Map<string, PdfBlankRegion>()

  for (const blank of blanks) {
    const pageSize = pageSizes[blank.pageIndex]
    if (!pageSize) continue
    const blankBox = blankRegionToBBox(blank, pageSize.width, pageSize.height)
    let best: { line: AnswerTarget; score: number } | null = null
    for (const line of lines) {
      if (!availableLines.has(line.id) || line.page !== blank.pageIndex + 1) continue
      const score = matchScore(blankBox, line.bbox!)
      if (score == null || (best && best.score <= score)) continue
      best = { line, score }
    }
    if (best) {
      availableLines.delete(best.line.id)
      contextByLineId.set(best.line.id, blank)
    }
  }

  const matchedBlankCount = contextByLineId.size
  if (matchedBlankCount / blanks.length < 0.7) return null

  const fused = lines
    .map((line, blankIndex) => {
      const pageSize = pageSizes[line.page - 1]
      return pageSize
        ? lineTargetToBlank(line, blankIndex, pageSize, contextByLineId.get(line.id))
        : null
    })
    .filter((blank): blank is PdfBlankRegion => blank !== null)

  if (fused.length !== lines.length) return null
  return {
    blanks: fused,
    consumedLineTargetIds: new Set(lines.map((line) => line.id)),
    matchedBlankCount,
  }
}
