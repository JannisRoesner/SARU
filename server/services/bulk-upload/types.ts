import type { GradeLevel } from '#shared/utils/jahrgangsstufen'
import type { MaterialType } from '#shared/types/domain'

/** Kennung in `import_runs.adapter_id` – getrennt vom Schulportal-Import. */
export const BULK_PDF_ADAPTER_ID = 'bulk-pdf-materials'
export const BULK_PDF_ADAPTER_VERSION = '1'
export const BULK_PDF_ADAPTER_LABEL = 'PDF-Stapel-Upload'

export const MAX_BULK_FILES = 40

export interface BulkUploadFileSuggestion {
  title: string
  materialType: MaterialType
  tagNames: string[]
  description: string
  /** true, wenn die Vorschläge vom Sprachmodell stammen. */
  aiUsed: boolean
}

export interface BulkUploadDetectedFile {
  sourceRef: string
  fileName: string
  sizeBytes: number
  checksum: string
  stagingPath: string
  pageCount: number | null
  hasText: boolean
  /** Kurzer Ausschnitt für die UI (nicht der volle Extrakt). */
  textPreview: string | null
  duplicate: { materialId: string; title: string; reason: string } | null
  suggestions: BulkUploadFileSuggestion
  warnings: string[]
}

export interface BulkUploadDetected {
  files: BulkUploadDetectedFile[]
  aiEnabled: boolean
  aiErrors: number
}

export interface BulkUploadRecordDecision {
  include: boolean
  title?: string
  materialType?: MaterialType
  description?: string
  tagNames?: string[]
  action?: 'erstellen' | 'ueberspringen'
  duplicateOfId?: string | null
}

export interface BulkUploadMapping {
  subjectId?: string | null
  subjectName?: string
  gradeLevel?: GradeLevel | null
  schoolForm?: string | null
  defaultMaterialType?: MaterialType
  linkDuplicates?: boolean
  records?: Record<string, BulkUploadRecordDecision>
}

export interface BulkUploadStats {
  materialien?: number
  dateien?: number
  uebersprungen?: number
  fehlgeschlagen?: number
}
