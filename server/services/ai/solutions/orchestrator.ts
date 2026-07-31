import type { PdfBlankRegion, TextBlankInfo, SolutionFillMode } from '../document-fill'
import { classifySolutionFillMode } from '../document-fill'
import { extractCandidateBank } from './candidate-bank'
import { analyzeDocument } from './document-analyzer'
import { classifyTasks, legacyFillModeFromTasks } from './task-classifier'
import { segmentTasks } from './task-segmenter'
import type { CandidateBank, DocumentModel, NativeField, TaskBlock } from './types'

export interface SolutionPlanInput {
  documentText: string
  pdfBlanks?: PdfBlankRegion[]
  docxBlanks?: TextBlankInfo[]
  nativeFields?: NativeField[]
}

export interface SolutionPlan {
  document: DocumentModel
  tasks: TaskBlock[]
  candidateBank: CandidateBank | null
  /** Legacy global mode – Fallback für ältere Pfade. */
  fillMode: SolutionFillMode
  blankCount: number
}

/**
 * Orchestriert Analyse → Segmentierung → Klassifikation.
 * generateSolution() bleibt der Einstieg; diese Funktion kapselt den Plan.
 */
export function buildSolutionPlan(input: SolutionPlanInput): SolutionPlan {
  const pdfBlanks = input.pdfBlanks ?? []
  const docxBlanks = input.docxBlanks ?? []
  const blankCount = pdfBlanks.length || docxBlanks.length
  const candidateBank = extractCandidateBank(input.documentText, blankCount)
  const document = analyzeDocument({
    fullText: input.documentText,
    pdfBlanks,
    docxBlanks,
    nativeFields: input.nativeFields,
  })
  const tasks = classifyTasks(
    segmentTasks({
      document,
      pdfBlanks,
      docxBlanks,
      candidateBank,
    }),
  )
  const fillMode: SolutionFillMode =
    tasks.length > 0
      ? legacyFillModeFromTasks(tasks)
      : classifySolutionFillMode(
          pdfBlanks.length ? pdfBlanks : docxBlanks,
          input.documentText,
        )

  return {
    document,
    tasks,
    candidateBank,
    fillMode,
    blankCount,
  }
}
