import type { GradeLevel } from '#shared/utils/jahrgangsstufen'

/**
 * Gemeinsame Zwischendarstellung für alle Importformate.
 *
 * Die Architektur trennt bewusst vier Schritte:
 *   1. Erkennung  (`detect`)   – welches Format liegt vor?
 *   2. Auswertung (`parse`)    – Rohdaten in diese Zwischendarstellung überführen
 *   3. Prüfung/Zuordnung       – Validierung, Dublettenerkennung, Nutzerkorrekturen
 *   4. Speicherung             – Anlegen der Entitäten und Protokollierung
 *
 * Ein neues Exportformat benötigt daher nur einen weiteren Adapter; Validierung,
 * Vorschau, Dublettenerkennung und Speicherung bleiben unverändert.
 */

export interface ImportSource {
  fileName: string
  buffer: Buffer
  sizeBytes: number
}

export interface DetectionResult {
  /** 0 = passt nicht, 1 = eindeutig erkannt. */
  confidence: number
  /** Kurze Begründung, die dem Nutzer angezeigt wird. */
  reason: string
}

export interface ParsedAttachment {
  /** Pfad innerhalb des Archivs – dient als stabile Referenz. */
  path: string
  fileName: string
  sizeBytes: number
}

export interface ParsedLesson {
  /** Stabile Kennung des Quelldatensatzes, z. B. `termin:2025-06-11:3`. */
  sourceRef: string
  date: string | null
  periodFrom: number | null
  periodTo: number | null
  /** Anzahl der Schulstunden laut Export. */
  periods: number | null
  topic: string
  content: string | null
  homework: string | null
  substituteTeacher: string | null
  attachments: ParsedAttachment[]
  /** Hinweise zu diesem Datensatz, z. B. fehlende Felder. */
  warnings: string[]
}

export interface ParsedCourse {
  /** Ursprünglicher Bezeichner, z. B. „Biologie 09b“. */
  rawName: string
  subjectName: string | null
  groupName: string | null
  gradeLevel: number | null
  /** Normalisiert als „2024/25“. */
  schoolYear: string | null
  halfYear: number | null
}

export interface ParsedExport {
  adapterId: string
  adapterVersion: string
  course: ParsedCourse
  exportedAt: string | null
  exportedBy: string | null
  lessons: ParsedLesson[]
  /** Dateien im Archiv, die keiner Stunde zugeordnet werden konnten. */
  orphanFiles: ParsedAttachment[]
  warnings: string[]
}

export interface ImportAdapter {
  id: string
  version: string
  label: string
  description: string
  /** Dateiendungen, die dieser Adapter grundsätzlich verarbeiten kann. */
  extensions: string[]
  detect(source: ImportSource): Promise<DetectionResult>
  parse(source: ImportSource): Promise<ParsedExport>
  /**
   * Liefert den Inhalt einer Anlage. Getrennt vom Parsen, damit große Dateien
   * erst beim tatsächlichen Import gelesen werden.
   */
  readAttachment(source: ImportSource, path: string): Promise<Buffer | null>
}
