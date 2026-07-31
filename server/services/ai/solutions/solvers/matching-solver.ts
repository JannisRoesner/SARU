import type { StructuredSolution } from '../../document-fill'
import type { TaskBlock } from '../types'

export interface MatchingPair {
  sourceId: string
  targetId: string
  value: string
}

/**
 * Extrahiert Zuordnungspaare aus der Modellantwort (matching_inline / matching_table).
 * Erwartetes answer-Format: „A → Beschreibung“ oder JSON in notes.
 */
export function solveMatchingTask(
  solution: StructuredSolution,
  task: TaskBlock,
): MatchingPair[] {
  const pairs: MatchingPair[] = []
  for (const answer of solution.answers) {
    const text = answer.answer.trim()
    const arrow = text.match(/^(.+?)\s*(?:→|->|=)\s*(.+)$/)
    if (arrow) {
      pairs.push({
        sourceId: arrow[1]!.trim(),
        targetId: arrow[2]!.trim(),
        value: arrow[1]!.trim(),
      })
      continue
    }
    if (typeof answer.blankIndex === 'number') {
      const target = task.targets.find((t) => t.blankIndex === answer.blankIndex)
      pairs.push({
        sourceId: answer.id,
        targetId: target?.id ?? `t-${answer.blankIndex}`,
        value: text,
      })
    }
  }
  return pairs
}
