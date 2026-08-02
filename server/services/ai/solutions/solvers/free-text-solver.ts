import type { StructuredSolution } from '../../document-fill'
import type { TaskBlock } from '../types'

interface InplaceTarget {
  id: string
  page: number
  bbox: NonNullable<TaskBlock['targets'][number]['bbox']>
  instruction: string
}

function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLocaleLowerCase('de-DE')
      .match(/[\p{L}\p{N}]{4,}/gu)
      ?.filter((word) => !['aufgabe', 'antwort', 'bitte', 'kurz', 'dabei'].includes(word)) ?? [],
  )
}

function taskMatchScore(
  answer: { label?: string | null; leftContext?: string | null; rightContext?: string | null },
  target: InplaceTarget,
): number {
  const answerWords = significantWords(
    `${answer.label ?? ''} ${answer.leftContext ?? ''} ${answer.rightContext ?? ''}`,
  )
  if (answerWords.size === 0) return 0
  const instructionWords = significantWords(target.instruction)
  let matches = 0
  for (const word of instructionWords) {
    if (answerWords.has(word)) matches += 1
  }
  return matches
}

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

  const lineTargets: InplaceTarget[] = inplaceTasks.flatMap((task) =>
    task.targets
      .filter((target) => target.bbox && (target.kind === 'answer_line' || target.kind === 'text_field'))
      .map((target) => ({
        id: target.id,
        page: target.page,
        bbox: target.bbox!,
        instruction: task.instruction,
      })),
  )

  const usedTargetIds = new Set<string>()

  const nextTargetFor = (answer: StructuredSolution['answers'][number]): InplaceTarget | undefined => {
    const explicit = answer.targetId
      ? lineTargets.find((target) => target.id === answer.targetId && !usedTargetIds.has(target.id))
      : undefined
    if (explicit) return explicit

    const scored = lineTargets
      .filter((target) => !usedTargetIds.has(target.id))
      .map((target) => ({ target, score: taskMatchScore(answer, target) }))
      .sort((a, b) => b.score - a.score)
    if (scored[0]?.score && scored[0].score > 0) return scored[0].target

    return lineTargets.find((target) => !usedTargetIds.has(target.id))
  }

  return {
    ...solution,
    answers: solution.answers.map((a) => {
      const looksFreitext =
        a.fieldType === 'freitext' ||
        a.blankIndex == null ||
        a.answer.length > 90 ||
        /\n/.test(a.answer)

      if (inplaceTasks.length > 0 && looksFreitext) {
        const target = nextTargetFor(a)
        if (target) {
          usedTargetIds.add(target.id)
          return {
            ...a,
            fieldType: 'freitext' as const,
            blankIndex: null,
            page: target.page,
            bbox: target.bbox,
            // Native Zielgeometrie ist verbindlich. Modell-bboxes sind für
            // Freitextlinien nur eine unverbindliche Schätzung.
            targetId: target.id,
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

/**
 * Bindet Modellantworten in Tabellenreihenfolge an die geometrisch erkannten
 * leeren Zellen. Die bbox bleibt dadurch bis zum PDF-Overlay erhalten.
 */
export function applyTableCellTaskMeta(
  solution: StructuredSolution,
  tasks: TaskBlock[],
): StructuredSolution {
  const targets = tasks
    .filter((task) => task.kind === 'matching_table')
    .flatMap((task) => task.targets)
    .filter((target) => target.kind === 'table_cell' && target.bbox)
    .sort((a, b) => (a.page - b.page) || ((a.blankIndex ?? 0) - (b.blankIndex ?? 0)))
  if (targets.length === 0) return solution

  const used = new Set<string>()
  let cursor = 0
  return {
    ...solution,
    answers: solution.answers.map((answer) => {
      const byIndex =
        typeof answer.blankIndex === 'number'
          ? targets.find((target) => target.blankIndex === answer.blankIndex)
          : undefined
      const target =
        (byIndex && !used.has(byIndex.id) ? byIndex : undefined) ??
        targets.find((candidate) => !used.has(candidate.id))
      if (!target?.bbox) return answer
      used.add(target.id)
      cursor += 1
      return {
        ...answer,
        label:
          answer.label && !/^lücke\s*\d+$/i.test(answer.label)
            ? answer.label
            : `Tabelle ${cursor}`,
        page: target.page,
        blankIndex: target.blankIndex ?? null,
        bbox: target.bbox,
        fieldType: 'luecke' as const,
        targetId: target.id,
      }
    }),
  }
}

/** Ordnet eine semantische Auswahl (z. B. richtig/falsch) genau einer Zelle je Aussage zu. */
export function applyChoiceCellTaskMeta(
  solution: StructuredSolution,
  tasks: TaskBlock[],
): StructuredSolution {
  const cells = tasks
    .flatMap((task) => task.targets)
    .filter((target) => target.kind === 'choice_cell' && target.bbox && target.choiceValue)
  if (cells.length === 0) return solution

  const rows = new Map<string, typeof cells>()
  for (const cell of cells) {
    const [page = String(cell.page), row = cell.id] = (cell.cellRef ?? cell.id).split(':')
    const key = `${page}:${row}`
    rows.set(key, [...(rows.get(key) ?? []), cell])
  }
  const orderedRows = [...rows.entries()]
    .sort(([a], [b]) => {
      const [pageA = 0, rowA = 0] = a.split(':').map(Number)
      const [pageB = 0, rowB = 0] = b.split(':').map(Number)
      return pageA - pageB || rowA - rowB
    })
    .map(([, row]) => row)

  let cursor = 0
  return {
    ...solution,
    answers: solution.answers.map((answer) => {
      const rowIndex =
        typeof answer.blankIndex === 'number' && answer.blankIndex >= 0
          ? answer.blankIndex
          : cursor
      const row = orderedRows[rowIndex]
      cursor += 1
      const choice = answer.answer
        .toLocaleLowerCase('de-DE')
        .match(/\b(richtig|falsch|ja|nein)\b/)?.[1]
      const target = row?.find((cell) => cell.choiceValue === choice)
      if (!target?.bbox) return answer
      return {
        ...answer,
        page: target.page,
        bbox: target.bbox,
        fieldType: 'luecke' as const,
        targetId: target.id,
      }
    }),
  }
}
