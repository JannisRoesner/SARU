import { describe, expect, it } from 'vitest'
import type { StructuredSolution } from '../../../server/services/ai/document-fill'
import {
  extractCandidateBank,
  formatCandidateBankForPrompt,
  normalizeCandidate,
} from '../../../server/services/ai/solutions/candidate-bank'
import { assignCandidatesGlobally } from '../../../server/services/ai/solutions/solvers/cloze-solver'
import { maximumWeightAssignment } from '../../../server/services/ai/solutions/solvers/bipartite-matching'
import {
  sanitizeOutOfBankAnswers,
  validateClozeAnswers,
} from '../../../server/services/ai/solutions/validators/cloze-validator'
import type { CandidateBank } from '../../../server/services/ai/solutions/types'
import { buildSolutionPrompt, SOLUTION_SYSTEM_PROMPT_LUECKENTEXT } from '../../../server/services/ai/prompts'

/** Erwartete Wortliste des AB „Die Vorhaut“. */
const VORHAUT_WORDS = [
  'Spitze',
  'unterschiedlich',
  'lang',
  'Hautschichten',
  'Schleimhaut',
  'Erektion',
  'Nervenenden',
  'Unterseite',
  'Eichel',
]

function vorhautBank(): CandidateBank {
  return {
    id: 'bank-1',
    candidates: VORHAUT_WORDS.map((value, i) => ({
      id: `c${i}`,
      value,
      normalized: normalizeCandidate(value),
    })),
    reusePolicy: 'once',
    source: 'wordlist_section',
  }
}

function solutionFromWords(words: string[]): StructuredSolution {
  return {
    summary: 'Lückentext Vorhaut',
    answers: words.map((answer, i) => ({
      id: String(i + 1),
      label: `Lücke ${i + 1}`,
      answer,
      blankIndex: i,
      leftContext: null,
      rightContext: null,
      fieldType: 'luecke' as const,
    })),
    formFields: [],
  }
}

describe('extractCandidateBank', () => {
  it('extrahiert Wortliste aus Abschnitt und setzt reusePolicy once', () => {
    const text = `
Wortliste:
Spitze, unterschiedlich, lang, Hautschichten, Schleimhaut, Erektion, Nervenenden, Unterseite, Eichel

Die ___ des Penis ist in der Regel …
`
    const bank = extractCandidateBank(text, 9)
    expect(bank).not.toBeNull()
    expect(bank!.candidates).toHaveLength(9)
    expect(bank!.reusePolicy).toBe('once')
    expect(bank!.candidates.map((c) => c.value)).toEqual(
      expect.arrayContaining(['Spitze', 'Eichel', 'Hautschichten']),
    )
  })

  it('extrahiert Schrägstrich-Wortliste ohne Überschrift (PDF-Textebene)', () => {
    const text = `
05_Arbeitsblatt: Die Vorhaut
Eichel / Erektion / Hautschichten / lang / Nervenenden / Schleimhaut / Spitze / unterschiedlich / Unterseite
Fülle die Lücken mit Wörtern aus der Wortliste.
Die ___ des Penis …
`
    const bank = extractCandidateBank({ documentText: '', pdfText: text, blankCount: 9 })
    expect(bank).not.toBeNull()
    expect(bank!.candidates).toHaveLength(9)
    expect(bank!.reusePolicy).toBe('once')
  })
})

describe('validateClozeAnswers – Vorhaut-Regression', () => {
  const bank = vorhautBank()

  it('lehnt typische Modell-Fehlantwort ab (outOfBank, Duplikate, unused)', () => {
    const bad = solutionFromWords([
      'Vorhaut',
      'unbeweglich',
      'sensibel',
      'Schichten',
      'Drüse',
      'Erektion',
      'Nervenenden',
      'Vorhaut',
      'Eichel',
    ])
    const result = validateClozeAnswers(bad, bank, 9)
    expect(result.valid).toBe(false)
    expect(result.violations.outOfBank).toEqual(
      expect.arrayContaining(['Vorhaut', 'unbeweglich', 'sensibel', 'Schichten', 'Drüse']),
    )
    // „Vorhaut“ steht nicht in der Bank → erscheint in outOfBank (auch mehrfach), nicht als Bank-Duplikat.
    expect(result.violations.outOfBank.filter((w) => w === 'Vorhaut').length).toBeGreaterThanOrEqual(2)
    expect(result.violations.unusedCandidates).toEqual(
      expect.arrayContaining([
        'Spitze',
        'unterschiedlich',
        'lang',
        'Hautschichten',
        'Schleimhaut',
        'Unterseite',
      ]),
    )
  })

  it('akzeptiert die korrekte bijektive Zuordnung', () => {
    const good = solutionFromWords(VORHAUT_WORDS)
    const result = validateClozeAnswers(good, bank, 9)
    expect(result.valid).toBe(true)
    expect(result.violations.outOfBank).toHaveLength(0)
    expect(result.violations.duplicates).toHaveLength(0)
    expect(result.violations.unusedCandidates).toHaveLength(0)
  })

  it('ersetzt out-of-bank Antworten durch ???', () => {
    const bad = solutionFromWords(['Vorhaut', ...VORHAUT_WORDS.slice(1)])
    const validation = validateClozeAnswers(bad, bank, 9)
    const sanitized = sanitizeOutOfBankAnswers(bad, bank, validation)
    expect(sanitized.answers[0]!.answer).toBe('???')
    expect(sanitized.uncertainties).toMatch(/Vorhaut/)
  })
})

describe('assignCandidatesGlobally', () => {
  it('erzwingt einmalige Nutzung der Vorhaut-Wortliste', () => {
    const bank = vorhautBank()
    const messy = solutionFromWords([
      'Eichel',
      'Eichel',
      'lang',
      'Hautschichten',
      'Schleimhaut',
      'Erektion',
      'Nervenenden',
      'Unterseite',
      'Spitze',
    ])
    const blanks = VORHAUT_WORDS.map((_, i) => ({
      blankIndex: i,
      leftText: i === 0 ? 'Die' : 'Kontext',
      rightText: i === 0 ? 'des Penis' : '.',
      page: 1,
    }))
    const assigned = assignCandidatesGlobally(messy, bank, blanks)
    const used = assigned.answers.map((a) => normalizeCandidate(a.answer))
    expect(new Set(used).size).toBe(9)
    for (const word of VORHAUT_WORDS) {
      expect(used).toContain(normalizeCandidate(word))
    }
    const validation = validateClozeAnswers(assigned, bank, 9)
    expect(validation.valid).toBe(true)
  })
})

describe('maximumWeightAssignment', () => {
  it('wählt die maximale diagonale Zuordnung', () => {
    const scores = [
      [0.9, 0.1, 0.1],
      [0.1, 0.95, 0.1],
      [0.2, 0.1, 0.8],
    ]
    const result = maximumWeightAssignment(scores)
    expect(result.assignment).toEqual([0, 1, 2])
    expect(result.totalScore).toBeCloseTo(2.65)
  })
})

describe('prompts – Candidate Bank', () => {
  it('enthält verbindliche Wortliste und kein Eichel-Beispiel mehr', () => {
    expect(SOLUTION_SYSTEM_PROMPT_LUECKENTEXT).not.toMatch(/Die ___ des Penis/)
    expect(SOLUTION_SYSTEM_PROMPT_LUECKENTEXT).toMatch(/AUSSCHLIESSLICH/)

    const bank = vorhautBank()
    const prompt = buildSolutionPrompt({
      title: 'AB Vorhaut',
      subjects: ['Biologie'],
      gradeLevels: [],
      topics: [],
      competencies: [],
      learningObjectives: [],
      fillMode: 'lueckentext',
      blankInventory: '0: „Die ___ des Penis“',
      detectedBlankCount: 9,
      candidateBank: bank,
    })
    expect(prompt).toContain('Verbindliche Wortliste')
    expect(prompt).toContain('Spitze')
    expect(prompt).toContain(formatCandidateBankForPrompt(bank).split('\n')[0]!)
    expect(prompt).toMatch(/jeden genau einmal/i)
  })
})
