import type { PdfBlankRegion, TextBlankInfo, SolutionFillMode } from '../document-fill'
import { classifySolutionFillMode } from '../document-fill'
import { extractCandidateBank } from './candidate-bank'
import { analyzeDocument } from './document-analyzer'
import { classifyTasks, legacyFillModeFromTasks } from './task-classifier'
import { segmentTasks } from './task-segmenter'
import type {
  AnswerTarget,
  CandidateBank,
  DocumentModel,
  NativeField,
  ShapeBlock,
  TaskBlock,
} from './types'

export interface SolutionPlanInput {
  documentText: string
  /** PDF-Textebene, falls documentText leer (z. B. fehlende DB-Extraktion). */
  pdfText?: string | null
  pdfBlanks?: PdfBlankRegion[]
  docxBlanks?: TextBlankInfo[]
  nativeFields?: NativeField[]
  shapes?: ShapeBlock[]
  /** Vollständige AnswerTargets aus DOCX-Analyse. */
  answerTargets?: AnswerTarget[]
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
 */
export function buildSolutionPlan(input: SolutionPlanInput): SolutionPlan {
  const pdfBlanks = input.pdfBlanks ?? []
  const docxBlanks = input.docxBlanks ?? []
  const blankCount = pdfBlanks.length || docxBlanks.length
  const analysisText =
    input.documentText.trim() ||
    input.pdfText?.trim() ||
    ''
  const blankContexts = [
    ...pdfBlanks.map((b) => `${b.leftText} ${b.rightText}`.trim()),
    ...docxBlanks.map((b) => `${b.leftText} ${b.rightText}`.trim()),
  ]
  const document = analyzeDocument({
    fullText: analysisText,
    pdfBlanks,
    docxBlanks,
    nativeFields: input.nativeFields,
    shapes: input.shapes,
    answerTargets: input.answerTargets,
  })
  const candidateBank = extractCandidateBank({
    documentText: input.documentText,
    pdfText: input.pdfText,
    documentModel: document,
    blankCount,
    blankContexts,
  })
  const tasks = classifyTasks(
    segmentTasks({
      document,
      pdfBlanks,
      docxBlanks,
      candidateBank,
      answerTargets: input.answerTargets,
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
