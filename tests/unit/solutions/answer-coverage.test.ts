import { describe, expect, it } from 'vitest'
import type { StructuredSolution } from '../../../server/services/ai/document-fill'
import type { AnswerTarget, TaskBlock } from '../../../server/services/ai/solutions/types'
import {
  assertAnswerCoverage,
  inspectAnswerCoverage,
} from '../../../server/services/ai/solutions/validators/answer-coverage'

function solution(
  answers: StructuredSolution['answers'],
): StructuredSolution {
  return { summary: 'Test', answers, formFields: [] }
}

function task(targets: AnswerTarget[], kind: TaskBlock['kind'] = 'cloze'): TaskBlock {
  return {
    id: 'task-1',
    page: 1,
    bbox: { x: 0, y: 0, w: 1, h: 1 },
    instruction: 'Test',
    kind,
    confidence: 1,
    evidence: [],
    targets,
    renderMode: 'overlay',
  }
}

describe('answer coverage gate', () => {
  it('unterscheidet ein leeres Zielinventar von teilweise befüllten Zielen', () => {
    const empty = inspectAnswerCoverage(solution([]), [task([])])
    expect(empty.status).toBe('no_targets')
    expect(() =>
      assertAnswerCoverage(solution([]), [task([])], { targetsExpected: true }),
    ).toThrow(/keine ausfüllbaren/i)

    const targets = Array.from({ length: 3 }, (_, blankIndex) => ({
      id: `blank-${blankIndex}`,
      kind: 'blank' as const,
      page: 1,
      blankIndex,
    }))
    const partialSolution = solution(
      targets.slice(0, 2).map((target) => ({
        id: target.id,
        label: target.id,
        answer: 'Antwort',
        blankIndex: target.blankIndex,
      })),
    )
    const partial = inspectAnswerCoverage(partialSolution, [task(targets)])
    expect(partial).toMatchObject({ status: 'partial', expected: 3, filled: 2 })
    expect(() => assertAnswerCoverage(partialSolution, [task(targets)])).toThrow(
      /3 Antwortbereiche.*nur 2/i,
    )
  })

  it('zählt bei Auswahlaufgaben Zeilen statt einzelner Zellen', () => {
    const cells: AnswerTarget[] = Array.from({ length: 6 }, (_, index) => ({
      id: `cell-${index}`,
      kind: 'choice_cell',
      page: 1,
      cellRef: `1:${Math.floor(index / 2)}:${index % 2}`,
      choiceValue: index % 2 ? 'falsch' : 'richtig',
    }))
    const result = inspectAnswerCoverage(
      solution([
        { id: 'a', label: '1', answer: 'richtig', targetId: 'cell-0' },
        { id: 'b', label: '2', answer: 'falsch', targetId: 'cell-3' },
      ]),
      [task(cells, 'matching_table')],
    )

    expect(result).toMatchObject({ status: 'partial', expected: 3, filled: 2 })
  })
})
