import type { SolutionBBox } from '../document-fill'
import type { AnswerTarget } from './types'

function iou(a: SolutionBBox, b: SolutionBBox): number {
  const aw = a.w ?? 0.05
  const ah = a.h ?? 0.03
  const bw = b.w ?? 0.05
  const bh = b.h ?? 0.03
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + aw, b.x + bw)
  const y2 = Math.min(a.y + ah, b.y + bh)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = aw * ah + bw * bh - inter
  return union > 0 ? inter / union : 0
}

function centerDistance(a: SolutionBBox, b: SolutionBBox): number {
  const ax = a.x + (a.w ?? 0.05) / 2
  const ay = a.y + (a.h ?? 0.03) / 2
  const bx = b.x + (b.w ?? 0.05) / 2
  const by = b.y + (b.h ?? 0.03) / 2
  return Math.hypot(ax - bx, ay - by)
}

export interface MergeTargetsResult {
  merged: AnswerTarget[]
  confidence: number
  requiresVisionRepair: boolean
  matchedPairs: number
  unmatchedVisual: number
}

/**
 * Verknüpft native und Vision-Targets per IoU/Proximity.
 * Unmatched Vision-Targets werden übernommen (source: vision).
 */
export function mergeNativeAndVisualTargets(
  native: AnswerTarget[],
  visual: AnswerTarget[],
): MergeTargetsResult {
  if (visual.length === 0) {
    const shapeHeavy =
      native.filter((t) =>
        t.kind === 'shape_oval' || t.kind === 'shape_box' || t.kind === 'answer_line',
      ).length > 0
    const fillable = native.filter(
      (t) =>
        t.kind === 'blank' ||
        t.kind === 'text_field' ||
        t.kind === 'content_control' ||
        t.kind === 'bookmark' ||
        t.kind === 'table_cell',
    ).length
    const requiresVisionRepair = shapeHeavy && fillable === 0
    return {
      merged: native,
      confidence: requiresVisionRepair ? 0.4 : native.length > 0 ? 0.85 : 0.3,
      requiresVisionRepair,
      matchedPairs: 0,
      unmatchedVisual: 0,
    }
  }

  const usedVisual = new Set<number>()
  const merged: AnswerTarget[] = []
  let matchedPairs = 0

  for (const n of native) {
    if (!n.bbox) {
      merged.push(n)
      continue
    }
    let bestIdx = -1
    let bestScore = 0
    for (let i = 0; i < visual.length; i++) {
      if (usedVisual.has(i)) continue
      const v = visual[i]!
      if (!v.bbox) continue
      const score = Math.max(iou(n.bbox, v.bbox), 1 - centerDistance(n.bbox, v.bbox) * 2)
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }
    if (bestIdx >= 0 && bestScore >= 0.25) {
      usedVisual.add(bestIdx)
      matchedPairs += 1
      const v = visual[bestIdx]!
      merged.push({
        ...n,
        bbox: n.bbox ?? v.bbox,
        leftText: n.leftText || v.leftText,
        rightText: n.rightText || v.rightText,
        source: 'native',
      })
    } else {
      merged.push(n)
    }
  }

  for (let i = 0; i < visual.length; i++) {
    if (usedVisual.has(i)) continue
    merged.push({ ...visual[i]!, source: 'vision' })
  }

  const unmatchedVisual = visual.length - usedVisual.size
  const matchRatio = visual.length > 0 ? matchedPairs / visual.length : 1
  const confidence = Math.max(0.25, Math.min(0.95, 0.4 + matchRatio * 0.5))
  const requiresVisionRepair =
    unmatchedVisual > Math.max(2, Math.floor(visual.length * 0.3)) ||
    (native.length === 0 && visual.length > 0)

  return {
    merged,
    confidence,
    requiresVisionRepair,
    matchedPairs,
    unmatchedVisual,
  }
}
