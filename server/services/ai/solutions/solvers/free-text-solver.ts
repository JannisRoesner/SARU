import type { StructuredSolution } from '../../document-fill'
import type { TaskBlock } from '../types'

/**
 * Markiert Freitext-Aufgaben: fieldType freitext, kein Overlay-blankIndex
 * wenn renderMode appendix.
 */
export function applyFreeTextTaskMeta(
  solution: StructuredSolution,
  tasks: TaskBlock[],
): StructuredSolution {
  const appendixIds = new Set(
    tasks.filter((t) => t.kind === 'free_text_separate').map((t) => t.id),
  )
  if (appendixIds.size === 0 && !tasks.some((t) => t.kind.startsWith('free_text'))) {
    return solution
  }

  return {
    ...solution,
    answers: solution.answers.map((a) => {
      if (a.fieldType === 'freitext' || a.blankIndex == null) {
        return {
          ...a,
          fieldType: 'freitext' as const,
          blankIndex: null,
          bbox: a.fieldType === 'freitext' ? null : a.bbox,
        }
      }
      return a
    }),
  }
}
