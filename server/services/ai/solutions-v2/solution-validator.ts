import { matchAnswerToCandidate } from '../solutions/candidate-bank'
import { getSolutionTaskHandlerV2 } from './handler-registry'
import type { QualityIssueV2, SolvedTask, TaskSpec } from './types'

export function validateSolvedTaskV2(task: TaskSpec, solved: SolvedTask): QualityIssueV2[] {
  const issues: QualityIssueV2[] = []
  const handler = getSolutionTaskHandlerV2(task.kind)
  if (solved.taskId !== task.taskId) {
    issues.push({
      code: 'MODEL_TASK_ID_MISMATCH',
      message: 'Das Modell hat eine andere taskId zurückgegeben.',
      taskId: task.taskId,
      blocking: true,
    })
  }

  const expected = new Map(task.answerSlots.map((slot) => [slot.targetId, slot]))
  const seen = new Set<string>()
  for (const answer of solved.answers) {
    const slot = expected.get(answer.targetId)
    if (!slot) {
      issues.push({
        code: 'MODEL_EXTRA_TARGET',
        message: 'Das Modell hat eine nicht erlaubte targetId ausgegeben.',
        taskId: task.taskId,
        targetIds: [answer.targetId],
        blocking: true,
      })
      continue
    }
    if (seen.has(answer.targetId)) {
      issues.push({
        code: 'MODEL_DUPLICATE_TARGET',
        message: 'Ein Antwortziel wurde mehrfach beantwortet.',
        taskId: task.taskId,
        targetIds: [answer.targetId],
        blocking: true,
      })
    }
    seen.add(answer.targetId)
    const value = answer.value.trim()
    if (!value || value === '???') {
      issues.push({
        code: 'ANSWER_EMPTY',
        message: 'Eine Antwort ist leer oder nur ein Platzhalter.',
        taskId: task.taskId,
        targetIds: [answer.targetId],
        blocking: true,
      })
    }
    for (const handlerIssue of handler.validateValue(task, slot, value)) {
      issues.push({
        ...handlerIssue,
        taskId: task.taskId,
        targetIds: [answer.targetId],
        blocking: true,
      })
    }
    if (value.length > slot.capacity.maxChars) {
      issues.push({
        code: 'ANSWER_EXCEEDS_CAPACITY',
        message: `Die Antwort ist für den vorgesehenen Bereich zu lang (${value.length}/${slot.capacity.maxChars}).`,
        taskId: task.taskId,
        targetIds: [answer.targetId],
        blocking: true,
      })
    }
  }

  const missing = [...expected.keys()].filter((targetId) => !seen.has(targetId))
  if (missing.length > 0) {
    issues.push({
      code: 'ANSWERS_PARTIAL',
      message: `${missing.length} Antwortziele wurden nicht beantwortet.`,
      taskId: task.taskId,
      targetIds: missing,
      blocking: true,
    })
  }

  if (task.candidateBank?.reusePolicy === 'once') {
    const normalized = solved.answers
      .map((answer) => matchAnswerToCandidate(answer.value, task.candidateBank!))
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      .map((candidate) => candidate.id)
    if (new Set(normalized).size !== normalized.length) {
      issues.push({
        code: 'CANDIDATE_REUSED',
        message: 'Mindestens ein nur einmal erlaubter Begriff wurde mehrfach verwendet.',
        taskId: task.taskId,
        blocking: true,
      })
    }
    const unused = task.candidateBank.candidates.filter((candidate) => !normalized.includes(candidate.id))
    if (unused.length > 0 && task.candidateBank.candidates.length === task.answerSlots.length) {
      issues.push({
        code: 'CANDIDATE_UNUSED',
        message: `Nicht verwendete Begriffe: ${unused.map((candidate) => candidate.value).join(', ')}.`,
        taskId: task.taskId,
        blocking: true,
      })
    }
  }
  return issues
}
