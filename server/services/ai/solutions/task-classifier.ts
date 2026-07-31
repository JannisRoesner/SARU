import type { TaskBlock, TaskKind, TaskRenderMode } from './types'

/**
 * Verfeinert Kind und RenderMode anhand Evidence und Targets.
 * Der Segmenter liefert bereits Startwerte; der Classifier bestätigt/korrigiert.
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

  if (blankTargets.length > 0) {
    kind = 'cloze'
    renderMode = 'overlay'
    evidence.push(`${blankTargets.length} answer targets detected`)
    if (bank && Math.abs(bank.candidates.length - blankTargets.length) <= 1) {
      confidence = Math.max(confidence, 0.97)
      evidence.push('instruction mentions word list or candidate count matches blanks')
      if (bank.reusePolicy === 'once') {
        evidence.push('candidate count equals blank count → reuse once')
      }
    } else if (/wortliste|lückentext|füllen sie die lücken/.test(instruction)) {
      confidence = Math.max(confidence, 0.9)
      evidence.push('instruction mentions word list')
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
  } else if (kind === 'unknown') {
    confidence = Math.min(confidence, 0.4)
    evidence.push('insufficient signals')
  }

  return {
    ...task,
    kind,
    confidence,
    evidence: [...new Set(evidence)],
    renderMode,
  }
}

export function classifyTasks(tasks: TaskBlock[]): TaskBlock[] {
  return tasks.map(classifyTask)
}

/** Legacy-Fallback: ein globaler Modus aus den klassifizierten Tasks. */
export function legacyFillModeFromTasks(
  tasks: TaskBlock[],
): 'lueckentext' | 'offen' {
  if (tasks.some((t) => t.kind === 'cloze' || t.kind === 'matching_inline' || t.kind === 'matching_table')) {
    return 'lueckentext'
  }
  if (tasks.some((t) => t.renderMode === 'overlay' || t.renderMode === 'native')) {
    return 'lueckentext'
  }
  return 'offen'
}
