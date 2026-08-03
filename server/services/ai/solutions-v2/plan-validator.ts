import type { QualityIssueV2, SolutionPlanV2 } from './types'

function validBox(box: { x: number; y: number; w?: number; h?: number } | null): boolean {
  if (!box) return true
  const w = box.w ?? 0
  const h = box.h ?? 0
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(w) &&
    Number.isFinite(h) &&
    box.x >= 0 &&
    box.y >= 0 &&
    w >= 0 &&
    h >= 0 &&
    box.x + w <= 1.001 &&
    box.y + h <= 1.001
  )
}

export function validateSolutionPlanV2(plan: SolutionPlanV2): QualityIssueV2[] {
  const issues: QualityIssueV2[] = []
  if (plan.tasks.length === 0) {
    issues.push({
      code: 'NO_TASKS_DETECTED',
      message: 'Im Dokument wurde keine Aufgabenstellung erkannt.',
      blocking: true,
    })
    return issues
  }

  const targetOwners = new Map<string, string>()
  for (const task of plan.tasks) {
    for (const issue of task.issues) {
      issues.push({
        code: /candidate|word list|wortliste/i.test(issue)
          ? 'CANDIDATE_BANK_INVALID'
          : 'LAYOUT_PLAN_CONFLICT',
        message: issue,
        taskId: task.taskId,
        blocking: true,
      })
    }
    if (task.kind === 'unsupported') {
      issues.push({
        code: 'UNSUPPORTED_TASK',
        message: 'Die Aufgabenart konnte nicht sicher klassifiziert werden.',
        taskId: task.taskId,
        blocking: true,
      })
    }
    if (task.answerSlots.length === 0) {
      issues.push({
        code: 'TASK_TARGETS_MISSING',
        message: 'Für die Aufgabe wurde kein Antwortziel erkannt.',
        taskId: task.taskId,
        blocking: true,
      })
    }
    for (const slot of task.answerSlots) {
      const previous = targetOwners.get(slot.targetId)
      if (previous) {
        issues.push({
          code: 'TARGET_ASSIGNED_MULTIPLE_TIMES',
          message: 'Ein Antwortziel wurde mehreren Aufgaben zugeordnet.',
          taskId: task.taskId,
          targetIds: [slot.targetId],
          blocking: true,
        })
      } else {
        targetOwners.set(slot.targetId, task.taskId)
      }
      if (!validBox(slot.bbox)) {
        issues.push({
          code: 'TARGET_GEOMETRY_INVALID',
          message: 'Ein Antwortziel liegt außerhalb der Seite.',
          taskId: task.taskId,
          targetIds: [slot.targetId],
          blocking: true,
        })
      }
      if (slot.renderPolicy !== 'appendix' && !slot.bbox && !slot.nativeRef) {
        issues.push({
          code: 'TASK_TARGETS_MISSING',
          message: 'Ein In-place-Ziel besitzt weder Geometrie noch native Referenz.',
          taskId: task.taskId,
          targetIds: [slot.targetId],
          blocking: true,
        })
      }
    }
  }
  return issues
}
