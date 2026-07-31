import type { StructuredSolution } from '../../document-fill'
import { matchAnswerToCandidate, normalizeCandidate } from '../candidate-bank'
import type { CandidateBank, ClozeValidationResult, ClozeViolations } from '../types'

/**
 * Validiert Lückentext-Antworten gegen eine Candidate Bank.
 * Bei reusePolicy „once“: jedes Wort genau einmal, alle Lücken aus der Bank.
 */
export function validateClozeAnswers(
  solution: StructuredSolution,
  bank: CandidateBank,
  blankCount: number,
): ClozeValidationResult {
  const answers = solution.answers.filter((a) => (a.answer ?? '').trim().length > 0)
  const violations: ClozeViolations = {
    outOfBank: [],
    duplicates: [],
    unusedCandidates: [],
  }

  if (blankCount > 0 && answers.length !== blankCount) {
    violations.countMismatch = { expected: blankCount, actual: answers.length }
  }

  const usedNormalized = new Map<string, number>()
  for (const answer of answers) {
    const text = answer.answer.trim()
    const match = matchAnswerToCandidate(text, bank)
    if (!match) {
      violations.outOfBank.push(text)
      continue
    }
    const count = usedNormalized.get(match.normalized) ?? 0
    usedNormalized.set(match.normalized, count + 1)
  }

  if (bank.reusePolicy === 'once') {
    for (const [norm, count] of usedNormalized) {
      if (count > 1) {
        const original =
          bank.candidates.find((c) => c.normalized === norm)?.value ?? norm
        violations.duplicates.push(original)
      }
    }
    for (const candidate of bank.candidates) {
      if (!usedNormalized.has(candidate.normalized)) {
        violations.unusedCandidates.push(candidate.value)
      }
    }
  } else {
    // Bei repeatable/unknown: nur outOfBank und optionale Count-Abweichung.
    // Unused ist Hinweis, kein harter Fehler außer once.
  }

  const valid =
    violations.outOfBank.length === 0 &&
    violations.duplicates.length === 0 &&
    (bank.reusePolicy !== 'once' || violations.unusedCandidates.length === 0) &&
    !violations.countMismatch

  return { valid, violations }
}

/** Ersetzt Antworten außerhalb der Bank durch ??? und markiert Unsicherheiten. */
export function sanitizeOutOfBankAnswers(
  solution: StructuredSolution,
  bank: CandidateBank,
  validation: ClozeValidationResult,
): StructuredSolution {
  if (validation.valid) return solution
  const outSet = new Set(validation.violations.outOfBank.map((a) => normalizeCandidate(a)))
  const answers = solution.answers.map((a) => {
    const text = (a.answer ?? '').trim()
    if (!text) return a
    if (matchAnswerToCandidate(text, bank)) return a
    if (outSet.has(normalizeCandidate(text)) || !matchAnswerToCandidate(text, bank)) {
      return { ...a, answer: '???' }
    }
    return a
  })

  const notes = [
    validation.violations.outOfBank.length
      ? `Außerhalb der Wortliste: ${validation.violations.outOfBank.join(', ')}`
      : null,
    validation.violations.duplicates.length
      ? `Doppelte Begriffe: ${validation.violations.duplicates.join(', ')}`
      : null,
    validation.violations.unusedCandidates.length
      ? `Ungenutzte Kandidaten: ${validation.violations.unusedCandidates.join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return {
    ...solution,
    answers,
    uncertainties: [solution.uncertainties, notes].filter(Boolean).join('\n') || notes,
  }
}
