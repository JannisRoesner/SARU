import type { GradeLevel } from '#shared/utils/jahrgangsstufen'
import type { AbbildungssammlungPlan } from '#shared/utils/abbildungen'
import type { MaterialType } from '#shared/types/domain'
import type {
  BulkFileRole,
  BulkFolderRole,
  BulkLernzirkelDecision,
  BulkLernzirkelRef,
} from '#shared/utils/bulk-upload'

export type { BulkFileRole, BulkFolderRole, BulkLernzirkelDecision, BulkLernzirkelRef }

/** Kennung in `import_runs.adapter_id` – getrennt vom Schulportal-Import. */
export const BULK_PDF_ADAPTER_ID = 'bulk-pdf-materials'
export const BULK_PDF_ADAPTER_VERSION = '2'
export const BULK_PDF_ADAPTER_LABEL = 'Stapel-Upload'

/**
 * Großzügige Plausibilitätsgrenze, damit Lehrwerke mit einigen tausend Dateien
 * in einen Stapel passen. Gegen ZIP-Bomben schützt die Größenprüfung vor dem
 * Entpacken (`maxImportBytes`), nicht diese Zahl.
 */
export const MAX_BULK_FILES = 10_000

/** Parallele Textextraktion inkl. Vision-OCR. */
export const BULK_EXTRACT_CONCURRENCY = 4
/** Parallele Metadaten-Vorschläge. */
export const BULK_AI_CONCURRENCY = 3

/** `abbildungssammlung`: alle Bilder eines Abbildungsordners werden zu einem Material. */
export type BulkClusterKind = 'paar' | 'varianten' | 'einzeln' | 'unklar' | 'abbildungssammlung'

/** Höchstzahl übersprungener Dateien, die mit Namen in der Vorschau erscheinen. */
export const MAX_UEBERSPRUNGEN_LISTE = 500

export interface BulkUebersprungeneDatei {
  pfad: string
  grund: string
}

/** Bündelung eines Abbildungsordners samt Angaben aus `abbildungen.json`. */
export interface BulkAbbildungssammlung {
  /** Ordnerpfad im Paket, z. B. „Biologie 1/Abbildungen/Cytologie“. */
  ordner: string
  plan: AbbildungssammlungPlan
  /** Fehler beim Lesen von `abbildungen.json` (die Datei wurde dann nicht verwendet). */
  manifestFehler: string[]
}

export const BULK_FILE_ROLES = ['schueler', 'loesung', 'einzeln', 'abbildung', 'anhaengsel', 'fassung'] as const

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
  /**
   * Keine Kopie mehr im Zwischenspeicher (übrige Dateien verworfen oder beim Rückgängigmachen
   * nicht wiederherstellbar). Das Bündel lässt sich dann nicht mehr anlegen.
   */
  stagingMissing?: boolean
  /** `abbildungen.json` bzw. `videos.json` – wird gelesen, aber nicht als Datei übernommen. */
  manifest?: boolean
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
  relationType: 'musterloesung' | 'gehoert_zu' | 'zusatzmaterial' | 'bezug'
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
  /** Gehört zu einem erkannten Lernzirkel (Stationenarbeit) – wird dort statt direkt am Lehrwerk einsortiert. */
  lernzirkel?: BulkLernzirkelRef
  /** Titel/Beschreibung stammen aus videos.json – kein KI-Textvorschlag nötig. */
  angabenAusPaket?: boolean
  /** Nur bei `kind: 'abbildungssammlung'`. */
  abbildungen?: BulkAbbildungssammlung
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
  /** Übersprungene Dateien mit Grund (höchstens MAX_UEBERSPRUNGEN_LISTE). */
  skippedFiles?: BulkUebersprungeneDatei[]
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
  gradeLevels?: GradeLevel[]
  /** @deprecated Nutze `gradeLevels`. Bleibt für bereits gestartete Läufe lesbar. */
  gradeLevel?: GradeLevel | null
  schoolForm?: string | null
  defaultMaterialType?: MaterialType
  linkDuplicates?: boolean
  createLehrwerk?: boolean
  lehrwerkTitle?: string
  /** Bestehendes oder nach dem Anlegen gesetztes Lehrwerk. */
  lehrwerkId?: string | null
  records?: Record<string, BulkUploadRecordDecision>
  /** Entscheidungen je erkanntem Lernzirkel (Schlüssel: `BulkLernzirkelRef.id`). */
  lernzirkel?: Record<string, BulkLernzirkelDecision>
  /** Nach dem Anlegen fehlende Bildangaben in Abbildungssammlungen per Vision-KI ergänzen. */
  abbildungenKi?: boolean
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
  fassungen?: number
  lernzirkel?: number
  abbildungen?: number
  uebersprungen?: number
  fehlgeschlagen?: number
}
