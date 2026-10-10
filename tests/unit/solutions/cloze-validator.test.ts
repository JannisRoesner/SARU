import { describe, expect, it } from 'vitest'
import type { StructuredSolution } from '../../../server/services/ai/document-fill'
import {
  extractCandidateBank,
  formatCandidateBankForPrompt,
  normalizeCandidate,
} from '../../../server/services/ai/solutions/candidate-bank'
import {
  assignCandidatesGlobally,
  countCandidateBackedBlanks,
} from '../../../server/services/ai/solutions/solvers/cloze-solver'
import { maximumWeightAssignment } from '../../../server/services/ai/solutions/solvers/bipartite-matching'
import {
  sanitizeOutOfBankAnswers,
  validateClozeAnswers,
} from '../../../server/services/ai/solutions/validators/cloze-validator'
import type { CandidateBank } from '../../../server/services/ai/solutions/types'
import {
  buildSolutionPrompt,
  SOLUTION_SYSTEM_PROMPT_LUECKENTEXT,
  solutionSystemPromptForMode,
} from '../../../server/services/ai/prompts'

/** Erwartete Wortliste des AB „Das Blatt“. */
const BLATT_WORDS = [
  'Spitze',
  'unterschiedlich',
  'lang',
  'Zellschichten',
  'Wachsschicht',
  'Spaltöffnung',
  'Leitbündel',
  'Unterseite',
  'Blattstiel',
]

function blattBank(): CandidateBank {
  return {
    id: 'bank-1',
    candidates: BLATT_WORDS.map((value, i) => ({
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
    summary: 'Lückentext Blatt',
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
Spitze, unterschiedlich, lang, Zellschichten, Wachsschicht, Spaltöffnung, Leitbündel, Unterseite, Blattstiel

Die ___ des Blattes ist in der Regel …
`
    const bank = extractCandidateBank(text, 9)
    expect(bank).not.toBeNull()
    expect(bank!.candidates).toHaveLength(9)
    expect(bank!.reusePolicy).toBe('once')
    expect(bank!.candidates.map((c) => c.value)).toEqual(
      expect.arrayContaining(['Spitze', 'Blattstiel', 'Zellschichten']),
    )
  })

  it('extrahiert Schrägstrich-Wortliste ohne Überschrift (PDF-Textebene)', () => {
    const text = `
05_Arbeitsblatt: Das Blatt
Blattstiel / Spaltöffnung / Zellschichten / lang / Leitbündel / Wachsschicht / Spitze / unterschiedlich / Unterseite
Fülle die Lücken mit Wörtern aus der Wortliste.
Die ___ des Blattes …
`
    const bank = extractCandidateBank({ documentText: '', pdfText: text, blankCount: 9 })
    expect(bank).not.toBeNull()
    expect(bank!.candidates).toHaveLength(9)
    expect(bank!.reusePolicy).toBe('once')
  })

  it('tokenisiert mehrzeilige Schrägstrich-Wortliste unter Überschrift (Blatt-Regression)', () => {
    const text = `
Wortliste:
Blattstiel / Spaltöffnung / Zellschichten / lang / Leitbündel /
Wachsschicht / Spitze / unterschiedlich / Unterseite
Fülle die Lücken mit Wörtern aus der Wortliste.
Die ___ des Blattes …
`
    const bank = extractCandidateBank({ documentText: '', pdfText: text, blankCount: 9 })
    expect(bank).not.toBeNull()
    expect(bank!.candidates).toHaveLength(9)
    expect(bank!.reusePolicy).toBe('once')
    expect(bank!.candidates.map((c) => c.value)).toEqual(
      expect.arrayContaining([
        'Blattstiel',
        'Spaltöffnung',
        'Zellschichten',
        'lang',
        'Leitbündel',
        'Wachsschicht',
        'Spitze',
        'unterschiedlich',
        'Unterseite',
      ]),
    )
  })
})

describe('validateClozeAnswers – Blatt-Regression', () => {
  const bank = blattBank()

  it('lehnt typische Modell-Fehlantwort ab (outOfBank, Duplikate, unused)', () => {
    const bad = solutionFromWords([
      'Blatt',
      'unbeweglich',
      'sensibel',
      'Schichten',
      'Drüse',
      'Spaltöffnung',
      'Leitbündel',
      'Blatt',
      'Blattstiel',
    ])
    const result = validateClozeAnswers(bad, bank, 9)
    expect(result.valid).toBe(false)
    expect(result.violations.outOfBank).toEqual(
      expect.arrayContaining(['Blatt', 'unbeweglich', 'sensibel', 'Schichten', 'Drüse']),
    )
    // „Blatt“ steht nicht in der Bank → erscheint in outOfBank (auch mehrfach), nicht als Bank-Duplikat.
    expect(result.violations.outOfBank.filter((w) => w === 'Blatt').length).toBeGreaterThanOrEqual(2)
    expect(result.violations.unusedCandidates).toEqual(
      expect.arrayContaining([
        'Spitze',
        'unterschiedlich',
        'lang',
        'Zellschichten',
        'Wachsschicht',
        'Unterseite',
      ]),
    )
  })

  it('akzeptiert die korrekte bijektive Zuordnung', () => {
    const good = solutionFromWords(BLATT_WORDS)
    const result = validateClozeAnswers(good, bank, 9)
    expect(result.valid).toBe(true)
    expect(result.violations.outOfBank).toHaveLength(0)
    expect(result.violations.duplicates).toHaveLength(0)
    expect(result.violations.unusedCandidates).toHaveLength(0)
  })

  it('ersetzt out-of-bank Antworten durch ???', () => {
    const bad = solutionFromWords(['Blatt', ...BLATT_WORDS.slice(1)])
    const validation = validateClozeAnswers(bad, bank, 9)
    const sanitized = sanitizeOutOfBankAnswers(bad, bank, validation)
    expect(sanitized.answers[0]!.answer).toBe('???')
    expect(sanitized.uncertainties).toMatch(/Blatt/)
  })
})

describe('assignCandidatesGlobally', () => {
  it('erzwingt einmalige Nutzung der Blatt-Wortliste', () => {
    const bank = blattBank()
    const messy = solutionFromWords([
      'Blattstiel',
      'Blattstiel',
      'lang',
      'Zellschichten',
      'Wachsschicht',
      'Spaltöffnung',
      'Leitbündel',
      'Unterseite',
      'Spitze',
    ])
    const blanks = BLATT_WORDS.map((_, i) => ({
      blankIndex: i,
      leftText: i === 0 ? 'Die' : 'Kontext',
      rightText: i === 0 ? 'des Blattes' : '.',
      page: 1,
    }))
    const assigned = assignCandidatesGlobally(messy, bank, blanks)
    const used = assigned.answers.map((a) => normalizeCandidate(a.answer))
    expect(new Set(used).size).toBe(9)
    for (const word of BLATT_WORDS) {
      expect(used).toContain(normalizeCandidate(word))
    }
    const validation = validateClozeAnswers(assigned, bank, 9)
    expect(validation.valid).toBe(true)
  })

  it('füllt fehlende Modellantworten nicht willkürlich mit Restwörtern auf', () => {
    const bank = blattBank()
    const incomplete = solutionFromWords([
      'Spitze',
      'unterschiedlich',
      'lang',
      'Zellschichten',
      'Wachsschicht',
      '???',
      '???',
      '???',
      '???',
    ])
    const blanks = BLATT_WORDS.map((_, i) => ({
      blankIndex: i,
      leftText: 'Kontext',
      rightText: '.',
      page: 1,
    }))

    expect(countCandidateBackedBlanks(incomplete, bank, blanks)).toBe(5)
    const assigned = assignCandidatesGlobally(incomplete, bank, blanks)
    expect(assigned.answers.map((answer) => answer.answer)).toEqual(
      incomplete.answers.map((answer) => answer.answer),
    )
    expect(validateClozeAnswers(assigned, bank, 9).valid).toBe(false)
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
  it('enthält verbindliche Wortliste und kein Blattstiel-Beispiel mehr', () => {
    expect(SOLUTION_SYSTEM_PROMPT_LUECKENTEXT).not.toMatch(/Die ___ des Blattes/)
    expect(SOLUTION_SYSTEM_PROMPT_LUECKENTEXT).toMatch(/AUSSCHLIESSLICH/)

    const bank = blattBank()
    const prompt = buildSolutionPrompt({
      title: 'AB Blatt',
      subjects: ['Biologie'],
      gradeLevels: [],
      topics: [],
      competencies: [],
      learningObjectives: [],
      fillMode: 'lueckentext',
      blankInventory: '0: „Die ___ des Blattes“',
      detectedBlankCount: 9,
      candidateBank: bank,
    })
    expect(prompt).toContain('Verbindliche Wortliste')
    expect(prompt).toContain('Spitze')
    expect(prompt).toContain(formatCandidateBankForPrompt(bank).split('\n')[0]!)
    expect(prompt).toMatch(/jeden genau einmal/i)
  })

  it('behandelt offene Aufgaben auf Schreiblinien nicht als Lückentext', () => {
    const prompt = buildSolutionPrompt({
      title: 'AB Pflanzenpflege',
      subjects: ['Biologie'],
      gradeLevels: [],
      topics: [],
      competencies: [],
      learningObjectives: [],
      fillMode: 'offen',
      answerLineCount: 2,
      inplaceOpenAnswers: true,
      taskInventory: '1. Gießen\n2. Umtopfen und Düngen',
    })

    expect(prompt).toContain('vorgesehenen Schreibbereichen')
    expect(prompt).not.toContain('separates PDF')
    expect(solutionSystemPromptForMode('offen', { inplaceOpenAnswers: true })).toContain(
      'Keine eigenen Koordinaten',
    )
  })
})
