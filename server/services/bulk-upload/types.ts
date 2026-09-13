import type { GradeLevel } from '#shared/utils/jahrgangsstufen'
import type { MaterialType } from '#shared/types/domain'
import type { BulkFileRole, BulkFolderRole } from '#shared/utils/bulk-upload'

export type { BulkFileRole, BulkFolderRole }

/** Kennung in `import_runs.adapter_id` – getrennt vom Schulportal-Import. */
export const BULK_PDF_ADAPTER_ID = 'bulk-pdf-materials'
export const BULK_PDF_ADAPTER_VERSION = '2'
export const BULK_PDF_ADAPTER_LABEL = 'Stapel-Upload'

/** Sicherheitsgrenze gegen ZIP-Bomben; die Paketgröße begrenzt zusätzlich. */
export const MAX_BULK_FILES = 400

/** Parallele Textextraktion inkl. Vision-OCR. */
export const BULK_EXTRACT_CONCURRENCY = 4
/** Parallele Metadaten-Vorschläge. */
export const BULK_AI_CONCURRENCY = 3

export type BulkClusterKind = 'paar' | 'einzeln' | 'unklar'

export const BULK_FILE_ROLES = ['schueler', 'loesung', 'einzeln', 'anhaengsel'] as const

export interface BulkUploadFileSuggestion {
  title: string
  materialType: MaterialType
  subjectNames: string[]
  tagNames: string[]
  description: string
  learningObjectives?: string[]
  contentSummary?: string
  schoolForm?: string | null
  /** true, wenn die Vorschläge vom Sprachmodell stammen. */
  aiUsed: boolean
}

export interface BulkUploadDetectedFile {
  sourceRef: string
  fileName: string
  relativePath?: string | null
  folderRole?: BulkFolderRole
  sizeBytes: number
  checksum: string
  stagingPath: string
  /** Sidecar mit dem einmalig extrahierten Volltext (Textebene oder Vision). */
  extractedTextKey?: string | null
  extractionMethod?: 'text_layer' | 'vision' | 'none'
  pageCount: number | null
  hasText: boolean
  /** Kurzer Ausschnitt für die UI (nicht der volle Extrakt). */
  textPreview: string | null
  duplicate: { materialId: string; title: string; reason: string } | null
  suggestions?: BulkUploadFileSuggestion
  warnings: string[]
}

export interface BulkProposedLink {
  targetClusterId: string
  relationType: 'musterloesung' | 'gehoert_zu' | 'zusatzmaterial'
  reason: string
  confidence: 'hoch' | 'mittel'
}

export interface BulkUploadDetectedCluster {
  clusterId: string
  kind: BulkClusterKind
  folderRole: BulkFolderRole
  stem: string
  fileRefs: string[]
  suggestedRoles: Record<string, BulkFileRole>
  suggestions: BulkUploadFileSuggestion
  proposedLinks: BulkProposedLink[]
  warnings: string[]
}

export interface BulkUploadDetected {
  files: BulkUploadDetectedFile[]
  clusters?: BulkUploadDetectedCluster[]
  aiEnabled: boolean
  aiErrors: number
  /** true, solange Textextraktion und KI-Vorschläge noch laufen. */
  analysisPending?: boolean
  archiveNames?: string[]
  skippedCount?: number
}

export interface BulkUploadRecordDecision {
  include: boolean
  title?: string
  materialType?: MaterialType
  description?: string
  tagNames?: string[]
  learningObjectives?: string[]
  content?: string
  action?: 'erstellen' | 'ueberspringen'
  duplicateOfId?: string | null
  fileRoles?: Record<string, BulkFileRole>
  links?: Record<string, boolean>
  solutionTitle?: string
}

export interface BulkUploadMapping {
  subjectId?: string | null
  subjectName?: string
  gradeLevel?: GradeLevel | null
  schoolForm?: string | null
  defaultMaterialType?: MaterialType
  linkDuplicates?: boolean
  createLehrwerk?: boolean
  lehrwerkTitle?: string
  /** Bestehendes oder nach dem Anlegen gesetztes Lehrwerk. */
  lehrwerkId?: string | null
  records?: Record<string, BulkUploadRecordDecision>
}

export interface BulkUploadInputFile {
  buffer: Buffer
  fileName: string
  relativePath?: string | null
}

export interface BulkUploadStats {
  materialien?: number
  dateien?: number
  verknuepft?: number
  uebersprungen?: number
  fehlgeschlagen?: number
}
