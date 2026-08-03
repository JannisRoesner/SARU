import type { SolvedTask, TaskSpec } from './types'
import { getSolutionTaskHandlerV2 } from './handler-registry'

export const V2_PROMPT_VERSIONS = {
  layout: 'solution-v2-layout-1',
  solve: 'solution-v2-solve-1',
  semantic: 'solution-v2-semantic-1',
  visual: 'solution-v2-visual-1',
} as const

export const TASK_SOLVER_SYSTEM_PROMPT = `Du löst genau eine Teilaufgabe eines deutschen Unterrichtsmaterials.

Verbindliche Regeln:
- Antworte ausschließlich mit einem vollständigen JSON-Objekt.
- Verwende ausschließlich die vorgegebenen taskId und targetId-Werte.
- Erfinde keine IDs, Koordinaten, Seiten, Felder oder zusätzlichen Ziele.
- Gib für jeden Answer-Slot genau eine fachlich passende Antwort zurück.
- Halte die angegebene Maximallänge ein.
- Wenn Kandidaten vorgegeben sind, verwende ausschließlich diese.

Schema:
{"taskId":"vorgegebene-id","answers":[{"targetId":"vorgegebene-id","value":"Antwort","rankings":[{"candidateId":"c0","score":0.9}]}],"uncertainties":[]}

rankings enthält bei einer Wortliste mit einmaliger Verwendung alle Kandidaten, sonst ein leeres Array. score liegt zwischen 0 und 1.`

export function buildTaskSolverPrompt(
  task: TaskSpec,
  options: { repairIssues?: string[] } = {},
): string {
  const handler = getSolutionTaskHandlerV2(task.kind)
  const candidates = task.candidateBank?.candidates ?? []
  const slots = task.answerSlots.map((slot) => ({
    targetId: slot.targetId,
    context: slot.promptContext,
    valueType: slot.valueType,
    allowedValues: slot.allowedValues ?? null,
    maxChars: slot.capacity.maxChars,
  }))
  const lines = [
    `taskId: ${task.taskId}`,
    `Aufgabenart: ${task.kind}`,
    `Aufgabenstellung: ${task.instruction}`,
    `Antwortschema: ${handler.answerSchema}`,
    ...handler.promptRules(task),
    '',
    `Answer-Slots (${slots.length}, verbindlich):`,
    JSON.stringify(slots),
  ]
  if (candidates.length > 0) {
    lines.push(
      '',
      `Kandidaten: ${JSON.stringify(candidates.map((candidate) => ({ id: candidate.id, value: candidate.value })))}`,
      `Wiederverwendung: ${task.candidateBank?.reusePolicy ?? 'unknown'}`,
    )
    if (task.candidateBank?.reusePolicy === 'once') {
      lines.push('Gib pro Slot rankings für alle Kandidaten an; jeder Kandidat wird insgesamt genau einmal gewählt.')
    }
  }
  if (options.repairIssues?.length) {
    lines.push('', 'Der vorige Versuch wurde abgelehnt. Korrigiere ausschließlich diese Punkte:', ...options.repairIssues)
  }
  lines.push('', 'Liefere ausschließlich das vollständige JSON-Objekt.')
  return lines.join('\n')
}

export const SEMANTIC_VERIFIER_SYSTEM_PROMPT = `Du prüfst genau eine bereits gelöste Teilaufgabe eines Unterrichtsmaterials.

Du änderst keine Antworten. Du bewertest nur, ob jede Antwort zur konkreten Aufgabenstellung und zu ihrem Slot-Kontext passt.
Antworte ausschließlich als vollständiges JSON:
{"taskId":"id","verdict":"pass|repair|uncertain","issues":[{"targetId":"id-oder-null","code":"SEMANTIC_MISMATCH","message":"kurze Begründung"}]}

pass nur, wenn alle Antworten plausibel sind. repair bei einem konkret behebbaren Fehler. uncertain, wenn Material oder Fachlage keine verlässliche Bewertung erlauben.`

export function buildSemanticVerifierPrompt(task: TaskSpec, solved: SolvedTask): string {
  const handler = getSolutionTaskHandlerV2(task.kind)
  const answers = solved.answers.map((answer) => {
    const slot = task.answerSlots.find((candidate) => candidate.targetId === answer.targetId)
    return {
      targetId: answer.targetId,
      context: slot?.promptContext ?? '',
      value: answer.value,
    }
  })
  return [
    `taskId: ${task.taskId}`,
    `Aufgabenart: ${task.kind}`,
    `Aufgabenstellung: ${task.instruction}`,
    `Prüffokus: ${handler.semanticFocus}`,
    `Zu prüfen: ${JSON.stringify(answers)}`,
    'Liefere ausschließlich das Prüf-JSON.',
  ].join('\n')
}
