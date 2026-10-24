import { istInteraktivDatei } from './interaktiv'
import {
  ABBILDUNG_BILD_ERWEITERUNGEN,
  bildUeberspringGrund,
  istAbbildungenManifest,
  istAbbildungsBildDatei,
  istInAbbildungsOrdner,
  istVideoDatei,
  VIDEO_ERWEITERUNGEN,
} from './abbildungen'
import { istMedienManifest } from './medien'

/** Dateiformate für „Material mit KI anlegen“ (Analyse + Metadaten-Vorschläge). */
export const AI_MATERIAL_FILE_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'odt',
  'odp',
  'ods',
  'txt',
  'md',
  'csv',
] as const

export type AiMaterialFileExtension = (typeof AI_MATERIAL_FILE_EXTENSIONS)[number]

const AI_MATERIAL_EXTENSION_SET = new Set<string>(AI_MATERIAL_FILE_EXTENSIONS)

export function isAiMaterialFileExtension(extension: string): boolean {
  return AI_MATERIAL_EXTENSION_SET.has(extension.toLowerCase().replace(/^\./, ''))
}

export function isAiMaterialFileName(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return false
  return isAiMaterialFileExtension(fileName.slice(dot + 1))
}

/** `accept`-Attribut für `<input type="file">`. */
export function aiMaterialAcceptAttribute(): string {
  const extensions = AI_MATERIAL_FILE_EXTENSIONS.map((ext) => `.${ext}`).join(',')
  const mimeTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.ms-powerpoint',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.presentation',
    'application/vnd.oasis.opendocument.spreadsheet',
    'text/plain',
    'text/markdown',
    'text/csv',
  ].join(',')
  return `${extensions},${mimeTypes}`
}

/** Kurzbeschreibung für Upload-Hinweise in der UI. */
export function aiMaterialFormatsLabel(): string {
  return 'PDF, Word (.doc/.docx), PowerPoint (.ppt/.pptx), Excel (.xls/.xlsx), OpenDocument (.odt/.odp/.ods) oder Text'
}

/** `accept`-Attribut für den Stapel-Upload inklusive ZIP-Pakete. */
export function bulkMaterialAcceptAttribute(): string {
  const bilder = ABBILDUNG_BILD_ERWEITERUNGEN.map((ext) => `.${ext}`).join(',')
  const videos = VIDEO_ERWEITERUNGEN.map((ext) => `.${ext}`).join(',')
  return `${aiMaterialAcceptAttribute()},.swf,application/x-shockwave-flash,${bilder},${videos},.json,.zip,application/zip`
}

/** „cover.png“, „Cover.JPG“, „Cover - Titel.webp“ – Bild, das im Stapel als Lehrwerk-Cover dienen kann. */
export function isLehrwerkCoverFileName(fileName: string): boolean {
  const name = fileName.split(/[\\/]/).pop() ?? fileName
  const match = /^(.+)\.(png|jpe?g|webp)$/i.exec(name)
  return Boolean(match && /^cover(?:[\s._-].*)?$/i.test(match[1]!.trim()))
}

/**
 * Einzeldokumente im Stapel: KI-analysierbare Formate, interaktive Inhalte (.swf), kurze Videos,
 * Lehrwerk-Cover sowie Bilder und `abbildungen.json` in Abbildungsordnern.
 * `pfad` ist der relative Pfad im Paket (oder nur der Dateiname, dann zählt kein Ordner).
 */
export function isBulkDocumentFileName(pfad: string): boolean {
  if (isAiMaterialFileName(pfad) || istInteraktivDatei(pfad) || istVideoDatei(pfad)) return true
  if (isLehrwerkCoverFileName(pfad) || istMedienManifest(pfad)) return true
  return (istAbbildungsBildDatei(pfad) || istAbbildungenManifest(pfad)) && istInAbbildungsOrdner(pfad)
}

export function isBulkMaterialFileName(pfad: string): boolean {
  return isBulkDocumentFileName(pfad) || /\.zip$/i.test(pfad)
}

/** Warum eine Datei im Stapel nicht übernommen wird – für die Liste „übersprungen“ in der Vorschau. */
export function bulkUeberspringGrund(pfad: string): string {
  return bildUeberspringGrund(pfad) ?? 'Kein unterstütztes Dateiformat.'
}
