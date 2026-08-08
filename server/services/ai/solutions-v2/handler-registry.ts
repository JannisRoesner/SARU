import { matchAnswerToCandidate } from '../solutions/candidate-bank'
import type { AnswerSlot, TaskKindV2, TaskSpec } from './types'

export interface HandlerValidationIssue {
  code: string
  message: string
}

export interface SolutionTaskHandlerV2 {
  kind: TaskKindV2
  promptRules: (task: TaskSpec) => string[]
  semanticFocus: string
  answerSchema: 'targeted_text' | 'targeted_choice' | 'unsupported'
  validateValue: (task: TaskSpec, slot: AnswerSlot, value: string) => HandlerValidationIssue[]
  renderKind: (
    slot: AnswerSlot,
    selectedChoice: boolean,
  ) => 'text' | 'mark' | 'appendix'
}

function renderKind(slot: AnswerSlot, selectedChoice: boolean): 'text' | 'mark' | 'appendix' {
  if (slot.renderPolicy === 'appendix') return 'appendix'
  return selectedChoice ? 'mark' : 'text'
}

function candidateValue(task: TaskSpec, _slot: AnswerSlot, value: string): HandlerValidationIssue[] {
  if (!task.candidateBank || matchAnswerToCandidate(value, task.candidateBank)) return []
  return [{
    code: 'ANSWER_OUT_OF_CANDIDATE_BANK',
    message: `„${value}“ stammt nicht aus der verbindlichen Wortliste.`,
  }]
}

function choiceValue(_task: TaskSpec, slot: AnswerSlot, value: string): HandlerValidationIssue[] {
  const allowed = slot.allowedValues?.map((candidate) => candidate.toLocaleLowerCase('de-DE')) ?? []
  if (allowed.length === 0 || allowed.includes(value.toLocaleLowerCase('de-DE'))) return []
  return [{ code: 'ANSWER_NOT_ALLOWED', message: `„${value}“ ist kein erlaubter Auswahlwert.` }]
}

const GERMAN_NUMBER = new Map<string, number>([
  ['ein', 1], ['eine', 1], ['einen', 1], ['eins', 1],
  ['zwei', 2], ['drei', 3], ['vier', 4], ['fünf', 5], ['sechs', 6],
  ['sieben', 7], ['acht', 8], ['neun', 9], ['zehn', 10],
])

function minimumFromInstruction(instruction: string, noun: string): number | null {
  const match = instruction.match(new RegExp(
    `mindestens\\s+(\\d+|[\\p{L}]+)(?:\\s+[\\p{L}-]+){0,3}\\s+${noun}`,
    'iu',
  ))
  if (!match?.[1]) return null
  const numeric = Number.parseInt(match[1], 10)
  return Number.isFinite(numeric)
    ? numeric
    : GERMAN_NUMBER.get(match[1].toLocaleLowerCase('de-DE')) ?? null
}

function validateFreeText(task: TaskSpec, _slot: AnswerSlot, value: string): HandlerValidationIssue[] {
  const issues: HandlerValidationIssue[] = []
  const sentenceMinimum = minimumFromInstruction(task.instruction, 'S(?:a|ä)tze(?:n)?')
  if (sentenceMinimum != null) {
    const sentenceCount = value.split(/[.!?]+(?:\s|$)/u).filter((part) => part.trim().length > 0).length
    if (sentenceCount < sentenceMinimum) {
      issues.push({
        code: 'ANSWER_MINIMUM_NOT_MET',
        message: `Gefordert sind mindestens ${sentenceMinimum} Sätze; erkannt wurden ${sentenceCount}.`,
      })
    }
  }

  const itemMinimum = minimumFromInstruction(
    task.instruction,
    '(?:Begriffe?|Beispiele?|Stichpunkte?|Aspekte?)',
  )
  if (itemMinimum != null) {
    const itemCount = value.split(/(?:\r?\n|[,;])/u).filter((part) => part.trim().length > 0).length
    if (itemCount < itemMinimum) {
      issues.push({
        code: 'ANSWER_MINIMUM_NOT_MET',
        message: `Gefordert sind mindestens ${itemMinimum} Einträge; erkannt wurden ${itemCount}.`,
      })
    }
  }

  if (
    /umgangssprach/iu.test(task.instruction) &&
    /\b(?:Testis|Testikel|Gonade(?:n)?)\b/iu.test(value)
  ) {
    issues.push({
      code: 'ANSWER_REGISTER_MISMATCH',
      message: 'Die Antwort enthält einen Fachbegriff, obwohl umgangssprachliche Begriffe verlangt sind.',
    })
  }

  // Schutz gegen den konkret beobachteten Fehlschluss „weniger Schmerz führt
  // zu mehr sexueller Aktivität/Schwangerschaft“. Der veränderte Schmerzreiz
  // ist ein Warnsignal; für die Familienplanung braucht die Antwort die Kette
  // über eine mögliche körperliche Schädigung und Fruchtbarkeit.
  if (/weniger\s+(?:weh|schmerz)|weniger\s+schmerzempfind/iu.test(task.instruction)) {
    if (/sexuell\w*\s+aktiv|mehr\s+sex|häufiger\w*\s+geschlechtsverkehr|schwangerschaft\s+einzugehen/iu.test(value)) {
      issues.push({
        code: 'ANSWER_UNSUPPORTED_CAUSAL_LEAP',
        message: 'Die Antwort unterstellt eine nicht genannte Änderung des Sexualverhaltens.',
      })
    }
    if (/familienplanung|fortbestand\s+der\s+menschheit/iu.test(task.instruction)) {
      const explainsDamage = /verletz|schäd|gewebeschaden|hodenschaden/iu.test(value)
      const explainsFertility = /sperm|fruchtbar|unfruchtbar|zeugungsf|fortpflanzungsf/iu.test(value)
      if (!explainsDamage || !explainsFertility) {
        issues.push({
          code: 'ANSWER_CAUSAL_CHAIN_INCOMPLETE',
          message: 'Die Antwort muss den Weg über mögliche Hodenschäden und eingeschränkte Fruchtbarkeit erklären.',
        })
      }
    }
  }
  return issues
}

function handler(
  kind: TaskKindV2,
  config: Omit<SolutionTaskHandlerV2, 'kind' | 'renderKind'>,
): SolutionTaskHandlerV2 {
  return { kind, renderKind, ...config }
}

const HANDLERS: Record<TaskKindV2, SolutionTaskHandlerV2> = {
  cloze: handler('cloze', {
    answerSchema: 'targeted_text',
    promptRules: () => [
      'Setze jeden Antwortwert gedanklich in den angegebenen Lückenkontext ein.',
      'Prüfe Grammatik und fachliche Bedeutung im vollständig rekonstruierten Satz.',
    ],
    semanticFocus: 'Prüfe insbesondere die vollständigen rekonstruierten Sätze und nicht nur die Wortmenge.',
    validateValue: candidateValue,
  }),
  free_text: handler('free_text', {
    answerSchema: 'targeted_text',
    promptRules: () => [
      'Formuliere einen knappen Erwartungshorizont, der in den vorgesehenen Bereich passt.',
      'Beantworte die gestellte Warum-/Wie-/Welche-Frage direkt und bilde eine nachvollziehbare fachliche Kausalkette.',
      'Übernimm Mindestanzahlen und Umfangsvorgaben aus der Aufgabenstellung vollständig.',
      'Vermeide spekulative Nebenfolgen und Aussagen, die für die Antwort nicht erforderlich oder fachlich nicht abgesichert sind.',
      'Bei Gedankenexperimenten darfst du keine zusätzliche Verhaltensänderung unterstellen. Unterscheide Wahrnehmung/Warnsignal von der weiterhin möglichen körperlichen Schädigung.',
      'Verwende bei verlangter Umgangssprache ausschließlich tatsächlich umgangssprachliche Ausdrücke, keine anatomischen Fachbegriffe.',
    ],
    semanticFocus: 'Prüfe Relevanz, verlangten Umfang, kausale Schlüssigkeit, Widerspruchsfreiheit und Materialbezug. Prüfe jede Kausalstufe und ob ungenannte Eigenschaften oder Verhaltensweisen verändert wurden. Frei erfundene Folgen, falsches Sprachregister oder am Kern der Frage vorbeigehende Antworten müssen repariert werden.',
    validateValue: validateFreeText,
  }),
  single_choice: handler('single_choice', {
    answerSchema: 'targeted_choice',
    promptRules: () => ['value muss exakt einem der für den Slot erlaubten Auswahlwerte entsprechen.'],
    semanticFocus: 'Prüfe jede Aussage getrennt gegen den gewählten erlaubten Wert.',
    validateValue: choiceValue,
  }),
  multi_choice: handler('multi_choice', {
    answerSchema: 'targeted_choice',
    promptRules: () => ['Verwende ausschließlich die pro Slot erlaubten Auswahlwerte.'],
    semanticFocus: 'Prüfe jede unabhängige Auswahl und die geforderte Mehrfachauswahl-Kardinalität.',
    validateValue: choiceValue,
  }),
  matching: handler('matching', {
    answerSchema: 'targeted_text',
    promptRules: () => ['Ordne jeden Wert dem semantisch passenden Ziel zu.'],
    semanticFocus: 'Prüfe die Richtung und Eindeutigkeit jeder Zuordnung.',
    validateValue: candidateValue,
  }),
  table_completion: handler('table_completion', {
    answerSchema: 'targeted_text',
    promptRules: () => ['Beachte für jede Zelle ausdrücklich Zeilenüberschrift, Spaltenüberschrift und Nachbarzellen.'],
    semanticFocus: 'Prüfe jede Antwort gegen ihren vollständigen Zeilen- und Spaltenkontext.',
    validateValue: candidateValue,
  }),
  diagram_labeling: handler('diagram_labeling', {
    answerSchema: 'targeted_text',
    promptRules: () => ['Verwende kurze, eindeutige Beschriftungen.'],
    semanticFocus: 'Prüfe, ob jede Beschriftung zum sichtbaren Zielbereich und zur Diagrammstruktur passt.',
    validateValue: candidateValue,
  }),
  unsupported: handler('unsupported', {
    answerSchema: 'unsupported',
    promptRules: () => ['Die Aufgabe ist nicht sicher unterstützt; erfinde keine Lösung.'],
    semanticFocus: 'Eine nicht unterstützte Aufgabe darf nicht automatisch freigegeben werden.',
    validateValue: () => [{ code: 'UNSUPPORTED_TASK', message: 'Die Aufgabenart wird nicht unterstützt.' }],
  }),
}

export function getSolutionTaskHandlerV2(kind: TaskKindV2): SolutionTaskHandlerV2 {
  return HANDLERS[kind]
}

export const solutionTaskHandlersV2 = HANDLERS
