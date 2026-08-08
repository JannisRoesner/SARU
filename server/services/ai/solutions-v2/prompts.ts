import type { SolvedTask, TaskSpec } from './types'
import { getSolutionTaskHandlerV2 } from './handler-registry'

export const V2_PROMPT_VERSIONS = {
  layout: 'solution-v2-layout-1',
  solve: 'solution-v2-solve-4',
  candidateAssignment: 'solution-v2-candidate-assignment-2',
  semantic: 'solution-v2-semantic-4',
  visual: 'solution-v2-visual-1',
} as const

export const TASK_SOLVER_SYSTEM_PROMPT = `Du löst genau eine Teilaufgabe eines deutschen Unterrichtsmaterials.

Verbindliche Regeln:
- Antworte ausschließlich mit einem vollständigen JSON-Objekt.
- Verwende ausschließlich die vorgegebenen taskId und targetId-Werte.
- Kopiere taskId und targetId bytegenau; kürze, übersetze oder nummeriere sie nicht um.
- Erfinde keine IDs, Koordinaten, Seiten, Felder oder zusätzlichen Ziele.
- Gib für jeden Answer-Slot genau eine fachlich passende Antwort zurück.
- Halte die angegebene Maximallänge ein.
- Wenn Kandidaten vorgegeben sind, verwende ausschließlich diese.
- Beantworte nur die konkrete Aufgabenstellung. Erfinde keine Ursachen, Folgen oder Fakten, die weder aus dem Material noch aus gesichertem Fachwissen folgen.
- Erfülle ausdrücklich verlangte Anzahlen und Formate (z. B. drei Begriffe oder drei Sätze).
- Bei Gedankenexperimenten bleibt alles unverändert, was die Aufgabenstellung nicht ausdrücklich verändert. Leite Folgen ausschließlich über die genannte Änderung her.
- Verwechsle ein Warnsignal oder Symptom nicht mit der zugrunde liegenden Verletzung bzw. Ursache. Unterstelle keine Verhaltens- oder Motivationsänderung, wenn sie nicht genannt ist.
- Wenn ein bestimmtes Sprachregister verlangt ist (z. B. umgangssprachlich), zählen Fachbegriffe oder bloße Wiederholungen des Ausgangsbegriffs nicht als passende Beispiele.

Schema:
{"taskId":"vorgegebene-id","answers":[{"targetId":"vorgegebene-id","value":"Antwort"}],"uncertainties":[]}

Eine Wortliste mit einmaliger Verwendung muss vollständig und ohne Wiederholung als value-Werte verwendet werden. rankings ist optional und wird nur für echte Unsicherheit verwendet.`

export function buildTaskSolverPrompt(
  task: TaskSpec,
  options: { repairIssues?: string[] } = {},
): string {
  const handler = getSolutionTaskHandlerV2(task.kind)
  const candidates = task.candidateBank?.candidates ?? []
  const slots = task.answerSlots.map((slot) => ({
    targetId: slot.targetId,
    page: slot.page,
    bbox: slot.bbox,
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
      lines.push('Wähle jeden Kandidaten insgesamt genau einmal. Gib die direkte Zuordnung als value zurück; keine vollständige Rangliste ausgeben.')
    }
  }
  if (options.repairIssues?.length) {
    lines.push('', 'Der vorige Versuch wurde abgelehnt. Korrigiere ausschließlich diese Punkte:', ...options.repairIssues)
  }
  lines.push(
    '',
    'Liefere ausschließlich das vollständige JSON-Objekt. Die Antworten müssen in derselben Reihenfolge wie die Answer-Slots stehen und deren IDs bytegenau übernehmen.',
  )
  return lines.join('\n')
}

export const CANDIDATE_ASSIGNMENT_VERIFIER_SYSTEM_PROMPT = `Du kontrollierst eine Zuordnungsaufgabe durch eine vollständig unabhängige Neuzuordnung.

Die erste Lösung wird dir absichtlich nicht gezeigt. Löse jeden Slot ausschließlich aus seinem Textkontext bzw. bei Diagrammen aus sichtbarer Zielposition, Führungslinie und Bildstruktur sowie der verbindlichen Wortliste.

Verbindliche Regeln:
- Antworte ausschließlich mit einem vollständigen JSON-Objekt.
- Verwende jede vorgegebene taskId und targetId exakt.
- Verwende ausschließlich die Kandidatenwerte und jeden davon genau einmal.
- Bei Lückentexten: Setze jeden Kandidaten gedanklich für ___ ein und prüfe Grammatik sowie Bedeutung.
- Bei Diagrammen: Verfolge jede sichtbare Führungslinie bis zum bezeichneten Bildelement; ordne nicht nur nach räumlicher Nähe.
- Erfinde keine IDs, Ziele oder zusätzlichen Antworten.

Schema:
{"taskId":"id","answers":[{"targetId":"id","value":"Kandidat"}],"uncertainties":[]}`

export function buildCandidateAssignmentVerifierPrompt(
  task: TaskSpec,
  options: { repairIssues?: string[] } = {},
): string {
  const lines = [
    `taskId: ${task.taskId}`,
    `Aufgabenstellung: ${task.instruction}`,
    `Kandidaten: ${JSON.stringify(task.candidateBank?.candidates.map((candidate) => candidate.value) ?? [])}`,
    `Slots: ${JSON.stringify(task.answerSlots.map((slot) => ({
      targetId: slot.targetId,
      page: slot.page,
      bbox: slot.bbox,
      context: slot.promptContext,
    })))}`,
  ]
  if (options.repairIssues?.length) {
    lines.push(
      'Der vorige Kontrollversuch war strukturell ungültig. Korrigiere diese Punkte:',
      ...options.repairIssues,
    )
  }
  lines.push('Ordne unabhängig zu und liefere ausschließlich das vollständige JSON.')
  return lines.join('\n')
}

export const SEMANTIC_VERIFIER_SYSTEM_PROMPT = `Du prüfst genau eine bereits gelöste Teilaufgabe eines Unterrichtsmaterials.

Du änderst keine Antworten. Du bewertest nur, ob jede Antwort zur konkreten Aufgabenstellung und zu ihrem Slot-Kontext passt.
Prüfe ausdrücklich, ob die Antwort die verlangte Anzahl, den verlangten Umfang und die kausale Fragestellung erfüllt. Markiere frei erfundene oder fachlich nicht ableitbare Aussagen als repair.
Prüfe jede Kausalstufe einzeln: Was wurde in der Aufgabe verändert, was bleibt gleich, und folgt jede behauptete Wirkung daraus? Eine unbelegte Änderung von Motivation oder Verhalten ist repair. Unterscheide Warnsignal/Symptom und zugrunde liegenden Schaden. Prüfe verlangte Sprachregister; Fachsprache zählt nicht als Umgangssprache.
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
