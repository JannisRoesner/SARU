import {
  fillDocxDocument,
  highlightDocxPrefilledClozeAnswers,
  type FilledDocument,
  type StructuredSolution,
} from '../../document-fill'
import { buildDocxRenderPlan } from '../docx-render-plan'
import { logPipeline } from '../logging'
import type { TaskBlock } from '../types'
import { applyDiagramMarksToDocx } from './docx-diagram-renderer'

export interface DocxRenderOptions {
  title: string
  notice?: string
  sourceFileName: string
  tasks: TaskBlock[]
  jobId?: string
  runId?: string
}

/**
 * Rendert DOCX aufgabenbasiert über Render-Plan (2f):
 * In-place / Textbox / Diagramm / Anchored Overlay / Anhang.
 */
export function renderDocxSolution(
  source: Buffer,
  solution: StructuredSolution,
  options: DocxRenderOptions,
): FilledDocument {
  const plan = buildDocxRenderPlan(options.tasks, solution)

  for (const route of plan.routes) {
    logPipeline('render.route_selected', {
      jobId: options.jobId,
      runId: options.runId,
      taskId: route.taskId,
      mode: route.mode,
      confidence: route.confidence,
    })
  }

  let buffer = source
  let priorFilled = 0

  // Lehrerfassungen: bereits eingetragene Lückenantworten in Lösungstinte markieren.
  const highlighted = highlightDocxPrefilledClozeAnswers(buffer)
  buffer = highlighted.buffer
  priorFilled += highlighted.highlighted
  if (highlighted.highlighted > 0) {
    logPipeline('render.prefilled_highlighted', {
      jobId: options.jobId,
      runId: options.runId,
      highlighted: highlighted.highlighted,
    })
  }

  const diagramTask = options.tasks.find((t) => t.kind === 'diagram_completion')
  if (
    diagramTask &&
    ((solution.diagramMarks?.length ?? 0) > 0 ||
      solution.answers.some(
        (a) =>
          a.targetId?.startsWith('shape-') ||
          a.targetId?.startsWith('txbx-') ||
          /^shape-\d+$/i.test(a.label),
      ))
  ) {
    const diagrammed = applyDiagramMarksToDocx(buffer, solution, diagramTask.targets)
    buffer = diagrammed.buffer
    priorFilled += diagrammed.filled
  }

  const result = fillDocxDocument(buffer, solution, {
    title: options.title,
    notice: options.notice,
    appendOpenAnswers: plan.appendOpenAnswers,
    forceAppendix: plan.forceAppendix,
    anchoredOverlays: plan.anchoredOverlays,
    priorFilled,
  })

  if (result.strategy === 'docx_appended' || result.strategy === 'docx_mixed') {
    logPipeline('render.fallback_appendix', {
      jobId: options.jobId,
      runId: options.runId,
      strategy: result.strategy,
      unresolved: plan.unresolvedTaskIds,
    })
  }

  // Prefer plan strategy when mixed was intended
  const strategy =
    plan.strategy === 'docx_mixed' && result.filled > 0
      ? 'docx_mixed'
      : result.strategy

  return {
    buffer: result.buffer,
    fileName: options.sourceFileName.replace(/\.docx$/i, '') + '-musterloesung.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    strategy,
    summary: solution.summary,
  }
}
