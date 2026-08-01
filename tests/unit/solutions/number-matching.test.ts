import { describe, expect, it } from 'vitest'
import {
  coerceAnswersToNumbers,
  detectNumberMatchingTask,
  extractNumberedTermMap,
  formatNumberMatchingForPrompt,
  instructionExpectsNumberAnswers,
  numberMatchingCandidateBank,
} from '../../../server/services/ai/solutions/number-matching'
import { buildSolutionPlan } from '../../../server/services/ai/solutions/orchestrator'
import type { PdfBlankRegion } from '../../../server/services/ai/document-fill'
import { buildSolutionPrompt } from '../../../server/services/ai/prompts'

const SPERMA_TEXT = `
Du bist kein Werwolf – Sexualerziehung © WDR 2020
10_Arbeitsblatt: Sperma
Viele Menschen denken, Sperma würde nur aus Samenzellen bestehen. Doch das stimmt nicht!
Schaue dir den Filmclip „Sperma“ an (Clip 10).
Ordne anschließend die Nummern der Begriffe den richtigen Aussagen zu.
___ bilden Samenzellen (Spermien)
___ reife Samenzellen sammeln sich hier.
___ geben oft schon vor dem Orgasmus klare, leicht schleimige Flüssigkeit ab
___ produziert dünnflüssiges, milchiges Sekret
___ produzieren eine Flüssigkeit mit viel Fruchtzucker
1 Cowpersche Drüsen 2 Prostata 3 Nebenhoden 4 Samenbläschen 5 Hoden
`

function blank(i: number, right: string): PdfBlankRegion {
  return {
    pageIndex: 0,
    blankIndex: i,
    x: 50,
    y: 400 - i * 20,
    width: 40,
    height: 12,
    kind: 'underscore',
    leftText: '',
    rightText: right,
  }
}

describe('number-matching', () => {
  it('erkennt Instruktion „Ordne die Nummern … zu“', () => {
    expect(instructionExpectsNumberAnswers(SPERMA_TEXT)).toBe(true)
    expect(
      instructionExpectsNumberAnswers('Fülle die Lücken mit der Wortliste.'),
    ).toBe(false)
  })

  it('extrahiert nummerierte Begriffslegende (inline)', () => {
    const legend = extractNumberedTermMap(SPERMA_TEXT)
    expect(legend).not.toBeNull()
    expect(legend!.entries.map((e) => e.number)).toEqual(['1', '2', '3', '4', '5'])
    expect(legend!.numberToTerm.get('5')).toMatch(/Hoden/i)
    expect(legend!.numberToTerm.get('2')).toMatch(/Prostata/i)
  })

  it('detectNumberMatchingTask liefert Bank mit Nummern', () => {
    const task = detectNumberMatchingTask(SPERMA_TEXT)
    expect(task).not.toBeNull()
    const bank = numberMatchingCandidateBank(task!, 5)
    expect(bank.candidates.map((c) => c.value)).toEqual(['1', '2', '3', '4', '5'])
    expect(bank.reusePolicy).toBe('once')
  })

  it('coerceAnswersToNumbers mappt Begriffe auf Ziffern', () => {
    const task = detectNumberMatchingTask(SPERMA_TEXT)!
    const coerced = coerceAnswersToNumbers(
      {
        summary: '',
        answers: [
          { id: '1', label: 'Lücke 1', answer: 'Hoden', page: 1, blankIndex: 0 },
          { id: '2', label: 'Lücke 2', answer: '3 Nebenhoden', page: 1, blankIndex: 1 },
          { id: '3', label: 'Lücke 3', answer: '1', page: 1, blankIndex: 2 },
        ],
        formFields: [],
        notesForTeacher: null,
        uncertainties: null,
      },
      task,
    )
    expect(coerced.answers.map((a) => a.answer)).toEqual(['5', '3', '1'])
  })

  it('Prompt enthält Antwortformat Nur Nummern', () => {
    const task = detectNumberMatchingTask(SPERMA_TEXT)!
    const prompt = buildSolutionPrompt({
      title: 'Sperma',
      subjects: [],
      gradeLevels: [],
      topics: [],
      competencies: [],
      learningObjectives: [],
      fillMode: 'lueckentext',
      numberMatching: task,
      candidateBank: numberMatchingCandidateBank(task, 5),
      detectedBlankCount: 5,
    })
    expect(prompt).toContain('Antwortformat: Nur Nummern')
    expect(prompt).toContain(formatNumberMatchingForPrompt(task).slice(0, 40))
    expect(prompt).toContain('Verbindliche Nummern')
  })

  it('buildSolutionPlan setzt Nummern-Bank für Sperma-AB', () => {
    const blanks = [
      blank(0, 'bilden Samenzellen'),
      blank(1, 'reife Samenzellen'),
      blank(2, 'geben oft schon'),
      blank(3, 'produziert dünnflüssiges'),
      blank(4, 'produzieren eine Flüssigkeit'),
    ]
    const plan = buildSolutionPlan({
      documentText: SPERMA_TEXT,
      pdfBlanks: blanks,
    })
    expect(plan.numberMatching).not.toBeNull()
    expect(plan.candidateBank?.candidates.map((c) => c.value)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ])
    expect(plan.tasks.some((t) => t.kind === 'matching_inline')).toBe(true)
  })
})
