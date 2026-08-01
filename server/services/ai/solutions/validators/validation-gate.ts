import { appError } from '../../../../utils/errors'
import type { ClozeValidationResult } from '../types'

export type ClozeValidationFailureCode =
  | 'CLOZE_VALIDATION_FAILED_AFTER_REPAIR'
  | 'CANDIDATE_BANK_MALFORMED'

/**
 * Wirft einen 422-Fehler, wenn die Cloze-Validierung endgültig fehlgeschlagen ist.
 * Verhindert das Speichern von ???-Platzhalter-Musterlösungen.
 */
export function assertClozeValidationPassed(
  validation: ClozeValidationResult,
  options: {
    errorCode?: ClozeValidationFailureCode
    message?: string
  } = {},
): void {
  if (validation.valid) return

  const errorCode = options.errorCode ?? 'CLOZE_VALIDATION_FAILED_AFTER_REPAIR'
  const message =
    options.message ??
    (errorCode === 'CANDIDATE_BANK_MALFORMED'
      ? 'Die Wortliste konnte nicht eindeutig in einzelne Begriffe zerlegt werden. Es wurde keine verwendbare Musterlösung erstellt.'
      : 'Die Musterlösung konnte nicht zuverlässig gegen die Wortliste validiert werden. Es wurde keine verwendbare Musterlösung erstellt.')

  throw appError('UNGUELTIGE_EINGABE', message, {
    details: {
      errorCode,
      violations: validation.violations,
    },
  })
}

/** True, wenn die Lösung noch ???-Platzhalter enthält. */
export function hasPlaceholderAnswers(
  answers: Array<{ answer?: string | null }>,
): boolean {
  return answers.some((a) => (a.answer ?? '').trim() === '???')
}
