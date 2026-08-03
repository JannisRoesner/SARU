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
    promptRules: () => ['Formuliere einen knappen Erwartungshorizont, der in den vorgesehenen Bereich passt.'],
    semanticFocus: 'Prüfe Relevanz, Widerspruchsfreiheit und Materialbezug; offene Antworten sind nicht eindeutig.',
    validateValue: () => [],
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
