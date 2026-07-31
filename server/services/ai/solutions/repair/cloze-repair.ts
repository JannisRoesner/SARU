import type { PdfBlankRegion, StructuredSolution, TextBlankInfo } from '../../document-fill'
import { formatCandidateBankForPrompt } from '../candidate-bank'
import type { CandidateBank, ClozeValidationResult } from '../types'

export interface ClozeRepairContext {
  bank: CandidateBank
  blanks: Array<Pick<PdfBlankRegion, 'blankIndex' | 'leftText' | 'rightText' | 'pageIndex'> | TextBlankInfo>
  validation: ClozeValidationResult
  previousAnswers: StructuredSolution
}

/** Baut einen gezielten Repair-Prompt nach fehlgeschlagener Wortlisten-Validierung. */
export function buildClozeRepairPrompt(context: ClozeRepairContext): string {
  const { bank, blanks, validation, previousAnswers } = context
  const v = validation.violations

  const frames = blanks
    .map((b) => {
      const idx = b.blankIndex
      const left = 'leftText' in b ? b.leftText : ''
      const right = 'rightText' in b ? b.rightText : ''
      const prev =
        previousAnswers.answers.find((a) => a.blankIndex === idx)?.answer ??
        previousAnswers.answers[idx]?.answer ??
        '—'
      return `${idx}: „${left || '…'} ___ ${right || '…'}“ (bisher: ${prev})`
    })
    .join('\n')

  const lines = [
    'Die vorherige Lösung verletzt die verbindliche Wortliste. Korrigiere sie vollständig.',
    '',
    '## Verbindliche Wortliste (Kandidaten)',
    formatCandidateBankForPrompt(bank),
    '',
    '## Verstöße der vorherigen Antwort',
  ]

  if (v.outOfBank.length) {
    lines.push(`- Nicht in der Wortliste: ${v.outOfBank.join(', ')}`)
  }
  if (v.duplicates.length) {
    lines.push(`- Mehrfach verwendet: ${v.duplicates.join(', ')}`)
  }
  if (v.unusedCandidates.length) {
    lines.push(`- Noch nicht verwendet: ${v.unusedCandidates.join(', ')}`)
  }
  if (v.countMismatch) {
    lines.push(
      `- Anzahl falsch: erwartet ${v.countMismatch.expected}, geliefert ${v.countMismatch.actual}`,
    )
  }

  lines.push(
    '',
    `## Satzrahmen (${blanks.length} Lücken) – blankIndex verbindlich`,
    frames,
    '',
    'Regeln für die Korrektur:',
    '- Verwende AUSSCHLIESSLICH die genannten Kandidaten.',
    bank.reusePolicy === 'once'
      ? '- Jeden Kandidaten GENAU einmal zuordnen (bijektive Zuordnung).'
      : '- Bevorzuge die Kandidaten; erfinde keine neuen Wörter.',
    '- Jede answer muss grammatisch in den Satzrahmen passen.',
    '- Liefere genau eine answer pro blankIndex (0…n-1).',
    '- Schema wie zuvor: JSON mit summary, answers[{id,label,answer,page,blankIndex,leftContext,rightContext,fieldType}], formFields, notesForTeacher, uncertainties.',
    '- Nur JSON, kein Markdown.',
  )

  return lines.join('\n')
}
