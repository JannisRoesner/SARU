import type { SolutionBBox } from '../document-fill'
import type { TaskBlock, TaskKind } from '../solutions/types'
import { candidateBankFromWords } from '../solutions/candidate-bank'
import { detectWorksheetTasks, type WorksheetTaskUnit } from '../solutions/worksheet-tasks'
import type { LayoutDocumentV2, LayoutPageV2 } from './types'

const TOKEN = /[\p{L}\p{N}]{4,}/gu

function tokens(value: string): Set<string> {
  return new Set((value.toLocaleLowerCase('de-DE').match(TOKEN) ?? []).filter((token) =>
    !['diese', 'dieser', 'dieses', 'einem', 'einer', 'einen', 'sowie', 'werden'].includes(token),
  ))
}

function similarity(a: string, b: string): number {
  const left = tokens(a)
  const right = tokens(b)
  if (left.size === 0 || right.size === 0) return 0
  let overlap = 0
  for (const token of left) if (right.has(token)) overlap += 1
  return overlap / Math.min(left.size, right.size)
}

function unionBBox(boxes: SolutionBBox[]): SolutionBBox {
  const x = Math.min(...boxes.map((box) => box.x))
  const y = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + (box.w ?? 0)))
  const bottom = Math.max(...boxes.map((box) => box.y + (box.h ?? 0)))
  return { x, y, w: Math.max(0.01, right - x), h: Math.max(0.01, bottom - y) }
}

function instructionBBox(page: LayoutPageV2, instruction: string, fallbackY: number): SolutionBBox {
  const instructionTokens = tokens(instruction)
  const hits = page.textSpans.filter((span) => {
    const spanTokens = tokens(span.text)
    for (const token of spanTokens) if (instructionTokens.has(token)) return true
    return false
  })
  if (hits.length === 0) return { x: 0.05, y: fallbackY, w: 0.9, h: 0.08 }
  const firstY = Math.min(...hits.map((span) => span.bbox.y))
  const local = hits.filter((span) => span.bbox.y <= firstY + 0.1).map((span) => span.bbox)
  const bbox = unionBBox(local.length > 0 ? local : [hits[0]!.bbox])
  return {
    x: Math.max(0.02, bbox.x - 0.01),
    y: Math.max(0, bbox.y - 0.01),
    w: Math.min(0.96, (bbox.w ?? 0.01) + 0.02),
    h: Math.min(0.14, (bbox.h ?? 0.01) + 0.02),
  }
}

function kindFor(unit: WorksheetTaskUnit): TaskKind {
  return unit.kind === 'image_labeling' ? 'matching_inline' : 'free_text_separate'
}

function taskFromUnit(page: LayoutPageV2, unit: WorksheetTaskUnit, index: number): TaskBlock {
  const instruction = unit.kind === 'glossary' && unit.terms?.length
    ? `${unit.instruction} Begriffe: ${unit.terms.join(', ')}`
    : unit.instruction
  return {
    id: `p${page.page}-layout-${unit.kind}-${index + 1}`,
    page: page.page,
    bbox: instructionBBox(page, instruction, unit.yNorm),
    instruction,
    kind: kindFor(unit),
    confidence: unit.confidence,
    evidence: [...unit.evidence, 'page-aware V2 text segmentation'],
    targets: [],
    candidateBank: unit.terms && unit.terms.length >= 2
      ? candidateBankFromWords(unit.terms, unit.terms.length, 'instruction') ?? undefined
      : undefined,
    renderMode: 'appendix',
    renderConfidence: unit.confidence >= 0.85 ? 'high' : 'medium',
  }
}

/**
 * Segmentiert ausschließlich ziel­lose Textaufgaben erneut pro realer Seite.
 * Aufgaben mit nativer Geometrie bleiben verbindlich und werden nie ersetzt.
 */
export function reconcileTasksWithPageLayoutV2(
  document: LayoutDocumentV2,
  inputTasks: TaskBlock[],
): TaskBlock[] {
  const authoritative = inputTasks.map((task) => task.targets.length > 0
    ? {
        ...task,
        page: task.targets[0]!.page,
        bbox: task.targets[0]!.bbox ?? task.bbox,
      }
    : task)
  const targetless = authoritative.filter((task) => task.targets.length === 0)
  const detected = document.pages.flatMap((page) => {
    const pageText = page.textSpans.map((span) => span.text).join(' ').replace(/\s+/g, ' ').trim()
    return detectWorksheetTasks(pageText).map((unit, index) => taskFromUnit(page, unit, index))
  })

  if (detected.length === 0) {
    return authoritative.map((task) => {
      if (task.targets.length > 0) return task
      const page = document.pages.find((candidate) =>
        similarity(candidate.textSpans.map((span) => span.text).join(' '), task.instruction) >= 0.45,
      )
      return page
        ? { ...task, page: page.page, bbox: instructionBBox(page, task.instruction, task.bbox.y) }
        : task
    })
  }

  const reconciledTargetless: TaskBlock[] = []
  const usedDetected = new Set<number>()
  for (const task of targetless) {
    let bestIndex = -1
    let bestScore = 0
    for (const [index, candidate] of detected.entries()) {
      if (usedDetected.has(index) || candidate.kind !== task.kind) continue
      const score = similarity(task.instruction, candidate.instruction)
      if (score > bestScore) {
        bestIndex = index
        bestScore = score
      }
    }
    if (bestIndex >= 0 && bestScore >= 0.45) {
      usedDetected.add(bestIndex)
      const candidate = detected[bestIndex]!
      reconciledTargetless.push({
        ...task,
        page: candidate.page,
        bbox: candidate.bbox,
        instruction: candidate.instruction,
        evidence: [...task.evidence, 'reconciled with page-aware V2 text segmentation'],
      })
    } else {
      reconciledTargetless.push(task)
    }
  }

  for (const [index, candidate] of detected.entries()) {
    if (usedDetected.has(index)) continue
    const duplicate = reconciledTargetless.some((task) =>
      task.kind === candidate.kind && similarity(task.instruction, candidate.instruction) >= 0.65,
    )
    if (!duplicate) reconciledTargetless.push(candidate)
  }

  return [
    ...authoritative.filter((task) => task.targets.length > 0),
    ...reconciledTargetless,
  ].sort((a, b) => a.page - b.page || a.bbox.y - b.bbox.y)
}
