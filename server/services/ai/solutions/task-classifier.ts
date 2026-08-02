import type {
  TaskBlock,
  TaskKind,
  TaskRenderMode,
  CandidateBankStatus,
  RenderConfidence,
} from './types'
import { instructionExpectsCandidateBank } from './candidate-bank'
import { instructionExpectsNumberAnswers } from './number-matching'

/**
 * Schätzt, wie sicher In-place-Rendering für diesen Task ist.
 */
export function resolveRenderConfidence(task: TaskBlock): RenderConfidence {
  if (task.renderConfidence) return task.renderConfidence

  const visionOnly =
    task.targets.length > 0 && task.targets.every((t) => t.source === 'vision')
  if (visionOnly) return 'low'

  if (task.kind === 'diagram_completion') {
    const withNative = task.targets.filter((t) => t.nativeRef).length
    if (withNative / Math.max(1, task.targets.length) < 0.5) return 'low'
    return 'medium'
  }

  if (task.kind === 'cloze') {
    const blanks = task.targets.filter((t) => t.kind === 'blank')
    if (blanks.some((b) => (b.leftText ?? '').length > 0)) return 'high'
    return 'medium'
  }

  if (
    task.targets.some(
      (t) => t.kind === 'content_control' || t.kind === 'bookmark',
    )
  ) {
    return 'high'
  }

  if (task.targets.some((t) => t.kind === 'text_field' || t.kind === 'table_cell')) {
    return 'medium'
  }

  if (task.renderMode === 'appendix') return 'high'
  return 'medium'
}

/**
 * Verfeinert Kind und RenderMode anhand Evidence und Targets.
 */
export function classifyTask(task: TaskBlock): TaskBlock {
  const evidence = [...task.evidence]
  let kind: TaskKind = task.kind
  let confidence = task.confidence
  let renderMode: TaskRenderMode = task.renderMode

  const hasTargets = task.targets.length > 0
  const blankTargets = task.targets.filter((t) => t.kind === 'blank')
  const bank = task.candidateBank
  const instruction = task.instruction.toLowerCase()
  const wordListExpected = instructionExpectsCandidateBank(task.instruction)
  let candidateBankStatus: CandidateBankStatus = bank
    ? 'found'
    : wordListExpected
      ? 'expected_but_missing'
      : 'not_applicable'
  let requiresCandidateBankRepair = candidateBankStatus === 'expected_but_missing'
  let requiresVisionTargetRepair = task.requiresVisionTargetRepair ?? false

  if (kind === 'diagram_completion') {
    renderMode = 'native'
    confidence = Math.max(confidence, 0.8)
    evidence.push('diagram completion task')
    if (task.targets.some((t) => !t.nativeRef || t.source === 'vision')) {
      requiresVisionTargetRepair = true
      evidence.push('diagram targets may need vision repair')
    }
  } else if (blankTargets.length > 0) {
    const numberMatching = instructionExpectsNumberAnswers(task.instruction)
    kind = numberMatching ? 'matching_inline' : 'cloze'
    renderMode = 'overlay'
    evidence.push(`${blankTargets.length} answer targets detected`)
    if (numberMatching) {
      evidence.push('instruction expects number answers (not terms)')
      confidence = Math.max(confidence, 0.9)
    }

    if (
      wordListExpected &&
      bank &&
      bank.candidates.length < blankTargets.length
    ) {
      candidateBankStatus = 'malformed'
      requiresCandidateBankRepair = true
      confidence = Math.max(0.4, confidence - 0.3)
      evidence.push(
        `candidate bank malformed: ${bank.candidates.length} terms for ${blankTargets.length} blanks`,
      )
    } else if (bank && Math.abs(bank.candidates.length - blankTargets.length) <= 1) {
      confidence = Math.max(confidence, 0.97)
      evidence.push('instruction mentions word list or candidate count matches blanks')
      if (bank.reusePolicy === 'once') {
        evidence.push('candidate count equals blank count → reuse once')
      }
    } else if (/wortliste|füllen sie die lücken/.test(instruction)) {
      confidence = Math.max(confidence, 0.9)
      evidence.push('instruction mentions word list')
      if (!bank) {
        confidence = Math.max(0.5, confidence - 0.25)
        evidence.push('candidate bank expected but missing')
      }
    } else {
      confidence = Math.max(confidence, 0.75)
    }
  } else if (
    /\b(beschreiben|erklären|erläutern|erörtern|vergleichen|diskutieren|begründen)\b/.test(
      instruction,
    )
  ) {
    kind = hasTargets ? 'free_text_inplace' : 'free_text_separate'
    renderMode = hasTargets ? 'overlay' : 'appendix'
    confidence = Math.max(confidence, 0.85)
    evidence.push('open-ended task verb without cloze blanks')
  } else if (task.targets.some((t) => t.kind === 'table_cell')) {
    kind = 'matching_table'
    renderMode = 'overlay'
    confidence = Math.max(confidence, 0.7)
    evidence.push('table cells as answer targets')
  } else if (task.targets.some((t) => t.kind === 'content_control' || t.kind === 'text_field')) {
    kind = 'free_text_inplace'
    renderMode = 'native'
    confidence = Math.max(confidence, 0.7)
  } else if (task.targets.some((t) => t.kind === 'answer_line')) {
    kind = kind === 'unknown' ? 'free_text_inplace' : kind
    renderMode = 'overlay'
    confidence = Math.max(confidence, 0.7)
    evidence.push('answer line targets')
  } else if (
    task.targets.some((t) => t.kind === 'shape_oval' || t.kind === 'shape_box')
  ) {
    kind = kind === 'unknown' ? 'free_text_inplace' : kind
    renderMode = 'native'
    confidence = Math.max(confidence, 0.65)
    evidence.push('geometric shape targets')
  } else if (kind === 'unknown') {
    confidence = Math.min(confidence, 0.4)
    evidence.push('insufficient signals')
  }

  const next: TaskBlock = {
    ...task,
    kind,
    confidence,
    evidence: [...new Set(evidence)],
    renderMode,
    candidateBankStatus,
    requiresCandidateBankRepair,
    requiresVisionTargetRepair,
  }
  next.renderConfidence = resolveRenderConfidence(next)
  return next
}

export function classifyTasks(tasks: TaskBlock[]): TaskBlock[] {
  return tasks.map(classifyTask)
}

/** Legacy-Fallback: ein globaler Modus aus den klassifizierten Tasks. */
export function legacyFillModeFromTasks(
  tasks: TaskBlock[],
): 'lueckentext' | 'offen' {
  // Der Füllmodus beschreibt die Semantik des Antwortformats, nicht die
  // Renderposition. Offene Antworten können auf Schreiblinien im Original
  // stehen und bleiben trotzdem Freitext statt Lückentext.
  if (
    tasks.some(
      (t) =>
        (t.kind === 'cloze' || t.kind === 'matching_table') &&
        t.targets.length > 0,
    )
  ) {
    return 'lueckentext'
  }
  return 'offen'
}
