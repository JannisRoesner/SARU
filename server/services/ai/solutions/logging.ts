import { createLogger } from '../../../utils/logger'

const log = createLogger('ai:solutions:pipeline')

export type SolutionPipelineEvent =
  | 'solution.run.started'
  | 'document.normalized'
  | 'task.detected'
  | 'candidate_bank.detected'
  | 'candidate_bank.expected_but_missing'
  | 'candidate_bank.repair_started'
  | 'candidate_bank.repaired'
  | 'task.classified'
  | 'task.solved'
  | 'task.validation_failed'
  | 'task.repair_started'
  | 'task.validation_passed'
  | 'render.task_completed'
  | 'render.route_selected'
  | 'render.prefilled_highlighted'
  | 'render.fallback_appendix'
  | 'solution.run.completed'
  | 'solution.run.review_required'
  | 'solution.run.failed'

export interface PipelineLogContext {
  jobId?: string
  runId?: string
  taskId?: string
  [key: string]: unknown
}

/** Strukturiertes Pipeline-Logging mit jobId/runId auf jeder Stufe. */
export function logPipeline(
  event: SolutionPipelineEvent,
  context: PipelineLogContext = {},
): void {
  const { jobId, runId, taskId, ...rest } = context
  log.info(event, {
    event,
    jobId: jobId ?? null,
    runId: runId ?? jobId ?? null,
    taskId: taskId ?? null,
    ...rest,
  })
}
