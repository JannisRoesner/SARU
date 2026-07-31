import type { StructuredSolution } from '../../document-fill'
import type { TaskBlock } from '../types'
import { solveMatchingTask, type MatchingPair } from './matching-solver'

/**
 * Tabellarische Zuordnung: gleiche Semantik wie Matching, Ziele sind Tabellenzellen.
 */
export function solveTableMatchingTask(
  solution: StructuredSolution,
  task: TaskBlock,
): MatchingPair[] {
  const pairs = solveMatchingTask(solution, task)
  return pairs.map((pair) => {
    const cell = task.targets.find(
      (t) => t.kind === 'table_cell' && (t.id === pair.targetId || t.cellRef === pair.targetId),
    )
    return cell?.cellRef
      ? { ...pair, targetId: cell.cellRef }
      : pair
  })
}
