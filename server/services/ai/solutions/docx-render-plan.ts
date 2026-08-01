import type { FillStrategy, StructuredSolution, SolutionBBox } from '../document-fill'
import type { RenderConfidence, TaskBlock } from './types'

export type DocxRenderRouteMode =
  | 'native'
  | 'textbox'
  | 'blanks'
  | 'shape'
  | 'diagram'
  | 'appendix'

export interface DocxRenderRoute {
  taskId: string
  mode: DocxRenderRouteMode
  confidence: RenderConfidence
}

export interface DocxRenderPlan {
  routes: DocxRenderRoute[]
  strategy: Extract<FillStrategy, 'docx_inplace' | 'docx_appended' | 'docx_mixed'>
  appendOpenAnswers: boolean
  forceAppendix: boolean
  unresolvedTaskIds: string[]
  anchoredOverlays: Array<{ bbox: SolutionBBox; text: string; id: string }>
}

function routeForTask(task: TaskBlock): DocxRenderRouteMode {
  if (task.kind === 'diagram_completion') return 'diagram'
  if (task.renderMode === 'appendix' || task.kind === 'free_text_separate') {
    return 'appendix'
  }
  if (task.kind === 'cloze') return 'blanks'
  if (task.targets.some((t) => t.kind === 'text_field')) return 'textbox'
  if (
    task.targets.some(
      (t) =>
        t.kind === 'shape_oval' ||
        t.kind === 'shape_box' ||
        t.kind === 'answer_line',
    )
  ) {
    return 'shape'
  }
  if (
    task.targets.some(
      (t) =>
        t.kind === 'content_control' ||
        t.kind === 'bookmark' ||
        t.kind === 'table_cell',
    )
  ) {
    return 'native'
  }
  return task.renderMode === 'native' ? 'native' : 'appendix'
}

/**
 * Plant Render-Routen anhand Task-Kind und Confidence.
 * Anhang nur bei low-confidence oder explizit offenen Tasks.
 */
export function buildDocxRenderPlan(
  tasks: TaskBlock[],
  solution: StructuredSolution,
): DocxRenderPlan {
  const routes: DocxRenderRoute[] = tasks.map((task) => ({
    taskId: task.id,
    mode: routeForTask(task),
    confidence: task.renderConfidence ?? 'medium',
  }))

  const hasInPlace = routes.some((r) => r.mode !== 'appendix')
  const hasAppendixRoute = routes.some((r) => r.mode === 'appendix')
  const lowConfidence = routes.filter(
    (r) => r.confidence === 'low' && r.mode !== 'appendix',
  )
  const unresolvedTaskIds = lowConfidence.map((r) => r.taskId)

  const appendOpenAnswers = hasAppendixRoute && hasInPlace
  const forceAppendix =
    unresolvedTaskIds.length > 0 ||
    (!hasInPlace && solution.answers.length > 0)

  // Vision-only shape targets → anchored overlays
  const anchoredOverlays: DocxRenderPlan['anchoredOverlays'] = []
  for (const task of tasks) {
    if (task.kind === 'diagram_completion') continue
    for (const target of task.targets) {
      if (target.source !== 'vision' || !target.bbox) continue
      const answer =
        solution.answers.find((a) => a.targetId === target.id)?.answer ??
        solution.answers.find((a) => a.label === target.id)?.answer
      if (!answer?.trim()) continue
      anchoredOverlays.push({
        id: target.id,
        bbox: target.bbox,
        text: answer.trim(),
      })
    }
  }

  let strategy: DocxRenderPlan['strategy'] = 'docx_appended'
  if (hasInPlace && (appendOpenAnswers || forceAppendix)) strategy = 'docx_mixed'
  else if (hasInPlace) strategy = 'docx_inplace'

  return {
    routes,
    strategy,
    appendOpenAnswers,
    forceAppendix: forceAppendix && !hasInPlace ? true : appendOpenAnswers && unresolvedTaskIds.length > 0,
    unresolvedTaskIds,
    anchoredOverlays,
  }
}
