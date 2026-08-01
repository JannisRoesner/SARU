import type { SolutionBBox, SolutionFillMode } from '../document-fill'

/** Wiederverwendungsregel für Wortlisten-Kandidaten. */
export type CandidateReusePolicy = 'once' | 'repeatable' | 'unknown'

export type CandidateBankSource = 'wordlist_section' | 'instruction' | 'vision'

export interface CandidateTerm {
  id: string
  value: string
  normalized: string
}

export interface CandidateBank {
  id: string
  candidates: CandidateTerm[]
  reusePolicy: CandidateReusePolicy
  source: CandidateBankSource
}

export type TaskKind =
  | 'cloze'
  | 'matching_inline'
  | 'matching_table'
  | 'free_text_inplace'
  | 'free_text_separate'
  | 'diagram_completion'
  | 'unknown'

export type TaskRenderMode = 'overlay' | 'native' | 'appendix'

export type RenderConfidence = 'high' | 'medium' | 'low'

export type AnswerTargetKind =
  | 'blank'
  | 'table_cell'
  | 'content_control'
  | 'bookmark'
  | 'text_field'
  | 'answer_line'
  | 'shape_oval'
  | 'shape_box'

/** Konkretes Antwortziel innerhalb einer Aufgabe. */
export interface AnswerTarget {
  id: string
  kind: AnswerTargetKind
  page: number
  bbox?: SolutionBBox | null
  /** 0-basierter Index bei Blank-Zielen (Dokument- oder Task-lokal). */
  blankIndex?: number | null
  leftText?: string
  rightText?: string
  /** DOCX: Alias/Tag eines Content Controls oder Bookmark-Name. */
  nativeRef?: string | null
  /** Tabellenzelle: „row:col“. */
  cellRef?: string | null
  /** Herkunft: native XML vs. Vision-Fallback. */
  source?: 'native' | 'vision'
}

export type CandidateBankStatus =
  | 'found'
  | 'expected_but_missing'
  | 'malformed'
  | 'not_applicable'

export interface TaskBlock {
  id: string
  page: number
  bbox: SolutionBBox
  instruction: string
  kind: TaskKind
  confidence: number
  evidence: string[]
  targets: AnswerTarget[]
  candidateBank?: CandidateBank
  candidateBankStatus?: CandidateBankStatus
  requiresCandidateBankRepair?: boolean
  /** Vision-Repair für fehlende/unsichere geometrische Ziele. */
  requiresVisionTargetRepair?: boolean
  renderMode: TaskRenderMode
  renderConfidence?: RenderConfidence
}

export interface TextBlock {
  id: string
  page: number
  text: string
  bbox?: SolutionBBox | null
}

export interface TableBlock {
  id: string
  page: number
  rows: string[][]
  bbox?: SolutionBBox | null
}

export interface ImageBlock {
  id: string
  page: number
  bbox?: SolutionBBox | null
}

export interface NativeField {
  id: string
  name: string
  kind: 'content_control' | 'bookmark' | 'form_field' | 'text_field'
  page?: number
}

export type ShapeBlockKind = 'line' | 'box' | 'oval' | 'shape' | 'textbox'

export interface ShapeBlock {
  id: string
  page: number
  kind: ShapeBlockKind
  bbox?: SolutionBBox | null
  nativeRef?: string | null
  anchorText?: string | null
}

export interface DocumentPage {
  index: number
  width: number
  height: number
}

/** Gemeinsame interne Darstellung für PDF/DOCX vor der Aufgabenanalyse. */
export interface DocumentModel {
  pages: DocumentPage[]
  textBlocks: TextBlock[]
  tables: TableBlock[]
  images: ImageBlock[]
  nativeFields: NativeField[]
  shapes: ShapeBlock[]
  /** Roher Extrakt für Heuristiken. */
  fullText: string
  /** Legacy-Füllmodus als Fallback. */
  legacyFillMode?: SolutionFillMode
}

export interface ClozeViolations {
  outOfBank: string[]
  duplicates: string[]
  unusedCandidates: string[]
  countMismatch?: { expected: number; actual: number }
}

export interface ClozeValidationResult {
  valid: boolean
  violations: ClozeViolations
}

/** Re-Export – kanonische Definition in document-fill.ts. */
export type { DiagramMark } from '../document-fill'
