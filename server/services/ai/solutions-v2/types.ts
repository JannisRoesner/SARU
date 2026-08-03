import type { SolutionBBox, StructuredSolution } from '../document-fill'
import type { AnswerTargetKind, CandidateBank, TaskBlock } from '../solutions/types'

export const SOLUTION_PIPELINE_VERSION = '2'

export type ObservationSource =
  | 'pdf_text'
  | 'pdf_vector'
  | 'docx_xml'
  | 'ocr'
  | 'vision'

export interface LayoutTextSpan {
  id: string
  page: number
  text: string
  bbox: SolutionBBox
}

export interface LayoutPageV2 {
  page: number
  width: number
  height: number
  textSpans: LayoutTextSpan[]
  extractionQuality: 'text_layer' | 'ocr' | 'empty'
}

export interface LayoutDocumentV2 {
  schemaVersion: 2
  sourceHash: string
  pages: LayoutPageV2[]
  fullText: string
}

export type LayoutObservationKind =
  | 'instruction'
  | 'candidate_bank'
  | 'blank'
  | 'answer_line'
  | 'table_cell'
  | 'choice_cell'
  | 'native_field'
  | 'diagram_target'

export interface LayoutObservation {
  id: string
  kind: LayoutObservationKind
  source: ObservationSource
  page: number
  bbox: SolutionBBox | null
  confidence: number
  text?: string | null
  sourceRef?: string | null
}

export type TaskKindV2 =
  | 'cloze'
  | 'free_text'
  | 'single_choice'
  | 'multi_choice'
  | 'matching'
  | 'table_completion'
  | 'diagram_labeling'
  | 'unsupported'

export type AnswerValueType = 'text' | 'number' | 'choice' | 'label'

export type RenderPolicy =
  | 'pdf_text_overlay'
  | 'pdf_mark_overlay'
  | 'docx_native_text'
  | 'docx_native_mark'
  | 'appendix'

export interface AnswerSlot {
  targetId: string
  page: number
  bbox: SolutionBBox | null
  promptContext: string
  targetKind: AnswerTargetKind | 'appendix'
  blankIndex?: number | null
  nativeRef?: string | null
  cellRef?: string | null
  choiceValue?: string | null
  /** Auswahlaufgabe: erlaubter Wert und das tatsächlich zu markierende Zellziel. */
  choiceTargets?: Array<{
    value: string
    targetId: string
    bbox: SolutionBBox | null
  }>
  valueType: AnswerValueType
  allowedValues?: string[]
  candidateIds?: string[]
  renderPolicy: RenderPolicy
  capacity: {
    maxChars: number
    maxLines: number
  }
  provenance: Array<{
    source: ObservationSource
    sourceRef: string
  }>
}

export interface TaskSpec {
  taskId: string
  kind: TaskKindV2
  page: number
  instruction: string
  instructionBBox: SolutionBBox | null
  confidence: number
  issues: string[]
  candidateBank?: CandidateBank | null
  answerSlots: AnswerSlot[]
}

export interface SolutionPlanV2 {
  schemaVersion: 2
  pipelineVersion: typeof SOLUTION_PIPELINE_VERSION
  sourceHash: string
  document: LayoutDocumentV2
  observations: LayoutObservation[]
  tasks: TaskSpec[]
}

export interface SolvedAnswer {
  targetId: string
  value: string
}

export interface SolvedTask {
  taskId: string
  answers: SolvedAnswer[]
  uncertainties: string[]
}

export type QualityStatus = 'passed' | 'warning' | 'failed' | 'unavailable'

export interface QualityIssueV2 {
  code: string
  message: string
  taskId?: string
  targetIds?: string[]
  blocking: boolean
}

export interface QualityReportV2 {
  plan: QualityStatus
  structure: QualityStatus
  semantic: QualityStatus
  render: QualityStatus
  issues: QualityIssueV2[]
}

export interface RenderOperationV2 {
  targetId: string
  taskId: string
  page: number
  kind: 'text' | 'mark' | 'appendix'
  value: string
  bbox: SolutionBBox | null
}

export interface RenderManifestV2 {
  schemaVersion: 2
  operations: RenderOperationV2[]
}

/** Übergabe an die bewährten PDF-/DOCX-Renderer. */
export interface RendererProjectionV2 {
  tasks: TaskBlock[]
  solution: StructuredSolution
  manifest: RenderManifestV2
}

export interface PipelineV2Result {
  plan: SolutionPlanV2
  solvedTasks: SolvedTask[]
  projection: RendererProjectionV2
  qualityReport: QualityReportV2
  model: string
  inputTokens: number
  outputTokens: number
}

export interface CanonicalPlanBuildV2 {
  plan: SolutionPlanV2
  rendererTasks: TaskBlock[]
}
