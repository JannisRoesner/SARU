import { describe, expect, it } from 'vitest'
import {
  extractCandidateBank,
  normalizeCandidate,
} from '../../../server/services/ai/solutions/candidate-bank'
import {
  assertClozeValidationPassed,
  hasPlaceholderAnswers,
} from '../../../server/services/ai/solutions/validators/validation-gate'
import {
  sanitizeOutOfBankAnswers,
  validateClozeAnswers,
} from '../../../server/services/ai/solutions/validators/cloze-validator'
import type { CandidateBank } from '../../../server/services/ai/solutions/types'
import type { StructuredSolution } from '../../../server/services/ai/document-fill'

const VORHAUT_WORDS = [
  'Eichel',
  'unterschiedlich',
  'lang',
  'Hautschichten',
  'Schleimhaut',
  'Erektion',
  'Nervenenden',
  'Unterseite',
  'Spitze',
]

function bankFromWords(words: string[]): CandidateBank {
  return {
    id: 'bank-1',
    candidates: words.map((value, i) => ({
      id: `c${i}`,
      value,
      normalized: normalizeCandidate(value),
    })),
    reusePolicy: words.length === 9 ? 'once' : 'repeatable',
    source: 'wordlist_section',
  }
}

function solutionFromWords(words: string[]): StructuredSolution {
  return {
    summary: 'Test',
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

describe('solution validation gate', () => {
  it('zerlegt die Vorhaut-Wortliste (zweizeilig mit /) in 9 Kandidaten', () => {
    const text = `
Wortliste:
Eichel / Erektion / Hautschichten / lang / Nervenenden /
Schleimhaut / Spitze / unterschiedlich / Unterseite
Fülle die Lücken mit Wörtern aus der Wortliste.
`
    const bank = extractCandidateBank({ documentText: '', pdfText: text, blankCount: 9 })
    expect(bank).not.toBeNull()
    expect(bank!.candidates).toHaveLength(9)
    expect(bank!.reusePolicy).toBe('once')
  })

  it('wirft bei endgültigem Validierungsfehler und speichert keine ???-Antworten', () => {
    const malformedBank = bankFromWords([
      'Eichel / Erektion / Hautschichten / lang / Nervenenden /',
      'Schleimhaut / Spitze / unterschiedlich / Unterseite',
    ])
    const answers = solutionFromWords(VORHAUT_WORDS)
    const validation = validateClozeAnswers(answers, malformedBank, 9)
    expect(validation.valid).toBe(false)
    expect(validation.violations.outOfBank.length).toBeGreaterThan(0)

    expect(() => assertClozeValidationPassed(validation)).toThrow()

    try {
      assertClozeValidationPassed(validation)
    } catch (error: unknown) {
      const err = error as { statusCode?: number; data?: { code?: string; details?: { errorCode?: string } }; message?: string }
      expect(err.statusCode).toBe(422)
      expect(err.data?.code).toBe('UNGUELTIGE_EINGABE')
      expect(err.data?.details?.errorCode).toBe('CLOZE_VALIDATION_FAILED_AFTER_REPAIR')
      expect(err.message).toMatch(/Wortliste|validiert/i)
    }

    // sanitize darf nur im Editor-Pfad ??? setzen – Generierung bricht vorher ab.
    const sanitized = sanitizeOutOfBankAnswers(answers, malformedBank, validation)
    expect(hasPlaceholderAnswers(sanitized.answers)).toBe(true)
  })

  it('lässt korrekte bijektive Zuordnung passieren', () => {
    const bank = bankFromWords(VORHAUT_WORDS)
    const answers = solutionFromWords(VORHAUT_WORDS)
    const validation = validateClozeAnswers(answers, bank, 9)
    expect(validation.valid).toBe(true)
    expect(() => assertClozeValidationPassed(validation)).not.toThrow()
    expect(hasPlaceholderAnswers(answers.answers)).toBe(false)
  })
})
