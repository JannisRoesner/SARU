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

const TRANSPORT_TEXT = `
10_Arbeitsblatt: Transport
Viele Menschen denken, Pflanzen würden nur über die Wurzeln trinken. Doch das stimmt nicht!
Schaue dir den Filmclip „Transport“ an (Clip 10).
Ordne anschließend die Nummern der Begriffe den richtigen Aussagen zu.
___ nehmen Wasser aus dem Boden auf.
___ transportieren Wasser und Nährstoffe nach oben.
___ öffnen sich bei Licht und lassen Gase hindurch
___ bilden den grünen Farbstoff für die Fotosynthese
___ speichern Zucker in Form von Stärke
1 Wurzelhaare 2 Leitbündel 3 Spaltöffnungen 4 Chloroplasten 5 Speichergewebe
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
    expect(instructionExpectsNumberAnswers(TRANSPORT_TEXT)).toBe(true)
    expect(
      instructionExpectsNumberAnswers('Fülle die Lücken mit der Wortliste.'),
    ).toBe(false)
  })

  it('extrahiert nummerierte Begriffslegende (inline)', () => {
    const legend = extractNumberedTermMap(TRANSPORT_TEXT)
    expect(legend).not.toBeNull()
    expect(legend!.entries.map((e) => e.number)).toEqual(['1', '2', '3', '4', '5'])
    expect(legend!.numberToTerm.get('5')).toMatch(/Speichergewebe/i)
    expect(legend!.numberToTerm.get('2')).toMatch(/Leitbündel/i)
  })

  it('detectNumberMatchingTask liefert Bank mit Nummern', () => {
    const task = detectNumberMatchingTask(TRANSPORT_TEXT)
    expect(task).not.toBeNull()
    const bank = numberMatchingCandidateBank(task!, 5)
    expect(bank.candidates.map((c) => c.value)).toEqual(['1', '2', '3', '4', '5'])
    expect(bank.reusePolicy).toBe('once')
  })

  it('coerceAnswersToNumbers mappt Begriffe auf Ziffern', () => {
    const task = detectNumberMatchingTask(TRANSPORT_TEXT)!
    const coerced = coerceAnswersToNumbers(
      {
        summary: '',
        answers: [
          { id: '1', label: 'Lücke 1', answer: 'Speichergewebe', page: 1, blankIndex: 0 },
          { id: '2', label: 'Lücke 2', answer: '3 Spaltöffnungen', page: 1, blankIndex: 1 },
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
    const task = detectNumberMatchingTask(TRANSPORT_TEXT)!
    const prompt = buildSolutionPrompt({
      title: 'Transport',
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

  it('buildSolutionPlan setzt Nummern-Bank für Transport-AB', () => {
    const blanks = [
      blank(0, 'nehmen Wasser aus dem Boden'),
      blank(1, 'transportieren Wasser'),
      blank(2, 'öffnen sich bei Licht'),
      blank(3, 'bilden den grünen Farbstoff'),
      blank(4, 'speichern Zucker'),
    ]
    const plan = buildSolutionPlan({
      documentText: TRANSPORT_TEXT,
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
