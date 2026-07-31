import { buildAnswerListPdf, type StructuredSolution } from '../../document-fill'

/** Erzeugt ein Anhangs-PDF nur mit Freitext-/Appendix-Antworten. */
export async function buildAnswerAppendixPdf(
  title: string,
  solution: StructuredSolution,
  options: { notice?: string } = {},
): Promise<Buffer> {
  const answers = solution.answers.filter(
    (a) => a.fieldType === 'freitext' || a.blankIndex == null,
  )
  return buildAnswerListPdf(
    title,
    { ...solution, answers: answers.length ? answers : solution.answers },
    options,
  )
}
