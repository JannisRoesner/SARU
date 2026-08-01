import type { StructuredSolution } from '../../document-fill'
import type { TaskBlock } from '../types'

/**
 * Markiert Freitext-Aufgaben:
 * - free_text_inplace: fieldType freitext, bbox von Answer-Line-Targets behalten/zuweisen
 * - free_text_separate: fieldType freitext, kein Overlay-blankIndex/bbox
 */
export function applyFreeTextTaskMeta(
  solution: StructuredSolution,
  tasks: TaskBlock[],
): StructuredSolution {
  const inplaceTasks = tasks.filter((t) => t.kind === 'free_text_inplace')
  const appendixTasks = tasks.filter((t) => t.kind === 'free_text_separate')
  if (inplaceTasks.length === 0 && appendixTasks.length === 0) {
    return solution
  }

  const lineTargets = inplaceTasks
    .flatMap((t) => t.targets)
    .filter((t) => t.bbox && (t.kind === 'answer_line' || t.kind === 'text_field'))

  let lineCursor = 0

  return {
    ...solution,
    answers: solution.answers.map((a) => {
      const looksFreitext =
        a.fieldType === 'freitext' ||
        a.blankIndex == null ||
        a.answer.length > 90 ||
        /\n/.test(a.answer)

      if (inplaceTasks.length > 0 && looksFreitext) {
        if (a.bbox) {
          return {
            ...a,
            fieldType: 'freitext' as const,
            blankIndex: null,
          }
        }
        const target = lineTargets[lineCursor]
        if (target?.bbox) {
          lineCursor += 1
          return {
            ...a,
            fieldType: 'freitext' as const,
            blankIndex: null,
            page: target.page,
            bbox: target.bbox,
            targetId: a.targetId ?? target.id,
          }
        }
        return {
          ...a,
          fieldType: 'freitext' as const,
          blankIndex: null,
        }
      }

      // Reiner Appendix-Modus: keine Overlay-Geometrie.
      if (appendixTasks.length > 0 && inplaceTasks.length === 0 && looksFreitext) {
        return {
          ...a,
          fieldType: 'freitext' as const,
          blankIndex: null,
          bbox: null,
        }
      }

      return a
    }),
  }
}
