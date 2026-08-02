import { appError } from '../../../../utils/errors'
import type { StructuredSolution } from '../../document-fill'
import type { AnswerTarget, TaskBlock } from '../types'

export type AnswerCoverageStatus = 'complete' | 'partial' | 'no_targets'

export interface AnswerCoverageResult {
  status: AnswerCoverageStatus
  expected: number
  filled: number
  missingTargetIds: string[]
}

interface ExpectedTarget {
  id: string
  targets: AnswerTarget[]
  blankIndex?: number
}

function expectedTargets(tasks: TaskBlock[]): ExpectedTarget[] {
  const expected: ExpectedTarget[] = []
  const seen = new Set<string>()

  for (const task of tasks) {
    const choiceRows = new Map<string, AnswerTarget[]>()
    for (const target of task.targets) {
      if (target.kind === 'choice_cell') {
        const rowKey = (target.cellRef ?? target.id).split(':').slice(0, 2).join(':')
        choiceRows.set(rowKey, [...(choiceRows.get(rowKey) ?? []), target])
        continue
      }
      if (!['blank', 'table_cell', 'answer_line', 'text_field'].includes(target.kind)) {
        continue
      }
      const key = target.kind === 'blank'
        ? `blank:${target.blankIndex ?? target.id}`
        : `target:${target.id}`
      if (seen.has(key)) continue
      seen.add(key)
      expected.push({
        id: target.id,
        targets: [target],
        blankIndex: target.kind === 'blank' ? target.blankIndex ?? undefined : undefined,
      })
    }
    for (const [rowKey, targets] of choiceRows) {
      const key = `choice:${rowKey}`
      if (seen.has(key)) continue
      seen.add(key)
      expected.push({ id: key, targets })
    }
  }
  return expected
}

function isUsableAnswer(answer: string | null | undefined): boolean {
  const value = (answer ?? '').trim()
  return Boolean(value && value !== '???')
}

/** Zählt deterministisch, ob jedes geometrisch erwartete Antwortziel befüllt ist. */
export function inspectAnswerCoverage(
  solution: StructuredSolution,
  tasks: TaskBlock[],
): AnswerCoverageResult {
  const expected = expectedTargets(tasks)
  if (expected.length === 0) {
    return { status: 'no_targets', expected: 0, filled: 0, missingTargetIds: [] }
  }

  const missingTargetIds: string[] = []
  for (const item of expected) {
    const targetIds = new Set(item.targets.map((target) => target.id))
    const found = solution.answers.some(
      (answer) =>
        isUsableAnswer(answer.answer) &&
        ((answer.targetId != null && targetIds.has(answer.targetId)) ||
          (item.blankIndex != null && answer.blankIndex === item.blankIndex)),
    )
    if (!found) missingTargetIds.push(item.id)
  }

  const filled = expected.length - missingTargetIds.length
  return {
    status: missingTargetIds.length === 0 ? 'complete' : 'partial',
    expected: expected.length,
    filled,
    missingTargetIds,
  }
}

export function assertAnswerCoverage(
  solution: StructuredSolution,
  tasks: TaskBlock[],
  options: { targetsExpected?: boolean } = {},
): AnswerCoverageResult {
  const coverage = inspectAnswerCoverage(solution, tasks)
  if (coverage.status === 'no_targets') {
    if (!options.targetsExpected) return coverage
    throw appError(
      'UNGUELTIGE_EINGABE',
      'Im Dokument wurden keine ausfüllbaren Lücken oder Antwortbereiche erkannt.',
      { details: { errorCode: 'NO_ANSWER_TARGETS_DETECTED', ...coverage } },
    )
  }
  if (coverage.status === 'partial') {
    throw appError(
      'UNGUELTIGE_EINGABE',
      `Es wurden ${coverage.expected} Antwortbereiche erkannt, aber nur ${coverage.filled} vollständig ausgefüllt. Es wurde keine unvollständige Musterlösung gespeichert.`,
      { details: { errorCode: 'ANSWER_TARGETS_PARTIALLY_FILLED', ...coverage } },
    )
  }
  return coverage
}
