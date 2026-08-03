import type { StructuredSolution } from '../document-fill'
import type { TaskBlock } from '../solutions/types'
import { getSolutionTaskHandlerV2 } from './handler-registry'
import type {
  RenderManifestV2,
  RendererProjectionV2,
  SolutionPlanV2,
  SolvedTask,
} from './types'

function shortLabel(instruction: string, index: number): string {
  const normalized = instruction.replace(/\s+/g, ' ').trim()
  return normalized.length > 80 ? `${normalized.slice(0, 77)}…` : normalized || `Aufgabe ${index + 1}`
}

export function projectSolutionForRenderV2(args: {
  plan: SolutionPlanV2
  rendererTasks: TaskBlock[]
  solvedTasks: SolvedTask[]
}): RendererProjectionV2 {
  const answers: StructuredSolution['answers'] = []
  const operations: RenderManifestV2['operations'] = []
  const diagramMarks: NonNullable<StructuredSolution['diagramMarks']> = []
  let answerIndex = 0

  for (const [taskIndex, task] of args.plan.tasks.entries()) {
    const handler = getSolutionTaskHandlerV2(task.kind)
    const solved = args.solvedTasks.find((candidate) => candidate.taskId === task.taskId)
    if (!solved) continue
    for (const solvedAnswer of solved.answers) {
      const slot = task.answerSlots.find((candidate) => candidate.targetId === solvedAnswer.targetId)
      if (!slot) continue
      const selectedChoice = slot.choiceTargets?.find(
        (candidate) => candidate.value.toLocaleLowerCase('de-DE') === solvedAnswer.value.toLocaleLowerCase('de-DE'),
      )
      const renderTargetId = selectedChoice?.targetId ?? slot.targetId
      const renderBBox = selectedChoice?.bbox ?? slot.bbox
      const isAppendix = slot.renderPolicy === 'appendix'
      const isFreeText = task.kind === 'free_text' || isAppendix
      answers.push({
        id: String(++answerIndex),
        label: shortLabel(task.instruction, taskIndex),
        answer: solvedAnswer.value,
        page: slot.page,
        blankIndex: slot.blankIndex ?? null,
        leftContext: slot.promptContext || null,
        rightContext: null,
        bbox: isAppendix ? null : renderBBox,
        fieldType: isFreeText ? 'freitext' : 'luecke',
        targetId: isAppendix ? null : renderTargetId,
      })
      operations.push({
        targetId: renderTargetId,
        taskId: task.taskId,
        page: slot.page,
        kind: handler.renderKind(slot, Boolean(selectedChoice)),
        value: selectedChoice ? 'X' : solvedAnswer.value,
        bbox: isAppendix ? null : renderBBox,
      })
      if (task.kind === 'diagram_labeling') {
        diagramMarks.push({ kind: 'label', text: solvedAnswer.value, targetId: renderTargetId })
      }
    }
  }

  const solution: StructuredSolution = {
    summary: 'Automatisch erzeugte Musterlösung.',
    answers,
    formFields: [],
    diagramMarks: diagramMarks.length > 0 ? diagramMarks : null,
  }
  return {
    tasks: args.rendererTasks,
    solution,
    manifest: { schemaVersion: 2, operations },
  }
}

export function validateRenderManifestV2(
  projection: RendererProjectionV2,
): Array<{ code: string; message: string; targetIds: string[] }> {
  const issues: Array<{ code: string; message: string; targetIds: string[] }> = []
  const seen = new Set<string>()
  for (const operation of projection.manifest.operations) {
    if (seen.has(operation.targetId) && operation.kind !== 'appendix') {
      issues.push({
        code: 'RENDER_TARGET_DUPLICATE',
        message: 'Ein Renderziel wird mehrfach beschrieben.',
        targetIds: [operation.targetId],
      })
    }
    seen.add(operation.targetId)
    const box = operation.bbox
    if (
      box &&
      (box.x < 0 || box.y < 0 || (box.w ?? 0) < 0 || (box.h ?? 0) < 0 ||
        box.x + (box.w ?? 0) > 1.001 || box.y + (box.h ?? 0) > 1.001)
    ) {
      issues.push({
        code: 'RENDER_TARGET_OUTSIDE_PAGE',
        message: 'Eine Renderoperation liegt außerhalb der Seite.',
        targetIds: [operation.targetId],
      })
    }
  }
  if (projection.manifest.operations.length !== projection.solution.answers.length) {
    issues.push({
      code: 'RENDER_MANIFEST_INCOMPLETE',
      message: 'Render-Manifest und Antwortmenge sind nicht deckungsgleich.',
      targetIds: [],
    })
  }
  return issues
}
