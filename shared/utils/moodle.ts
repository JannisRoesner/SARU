import type { MaterialType } from '../types/domain'
import { materialTypes } from './labels'

export const KURSARCHIV_ERWEITERUNGEN = ['mbz', 'imscc'] as const
export type KursarchivErweiterung = (typeof KURSARCHIV_ERWEITERUNGEN)[number]

/** Aus einem Kursarchiv (.mbz oder .imscc) extrahierte Metadaten. */
export interface MbzMetadata {
  archiveFormat: KursarchivErweiterung
  fullName: string | null
  shortName: string | null
  summary: string | null
  moodleRelease: string | null
  moodleVersion: string | null
  backupDate: string | null
  courseFormat: string | null
  /** IMS-Common-Cartridge-Schemaversion (nur .imscc). */
  cartridgeVersion: string | null
  originalFileName: string | null
}

export function istMoodleKursMaterial(type: string | null | undefined): type is 'moodle_kurs' {
  return type === 'moodle_kurs'
}

export function istH5pMaterial(type: string | null | undefined): type is 'h5p' {
  return type === 'h5p'
}

export function istH5pDatei(fileName: string | null | undefined): boolean {
  return (fileName ?? '').toLowerCase().endsWith('.h5p')
}

/** Materialien/Dateien ohne PDF-Miniatur – stattdessen Icon-Kachel in der Vorschau. */
export function materialZeigtIconVorschau(
  materialType: MaterialType | string | null | undefined,
  fileName?: string | null,
): boolean {
  return (
    istMoodleKursMaterial(materialType) ||
    istMoodleBackupDatei(fileName) ||
    istH5pMaterial(materialType) ||
    istH5pDatei(fileName)
  )
}

export function kursarchivErweiterung(
  fileName: string | null | undefined,
): KursarchivErweiterung | null {
  const lower = (fileName ?? '').toLowerCase()
  if (lower.endsWith('.mbz')) return 'mbz'
  if (lower.endsWith('.imscc')) return 'imscc'
  return null
}

export function istKursarchivDatei(fileName: string | null | undefined): boolean {
  return kursarchivErweiterung(fileName) !== null
}

/** @deprecated Alias für {@link istKursarchivDatei}. */
export function istMoodleBackupDatei(fileName: string | null | undefined): boolean {
  return istKursarchivDatei(fileName)
}

export function istKursarchivErweiterung(ext: string | null | undefined): ext is KursarchivErweiterung {
  return KURSARCHIV_ERWEITERUNGEN.includes(ext as KursarchivErweiterung)
}

function kursarchivDateinameOhneEndung(fileName?: string | null): string | undefined {
  return fileName?.replace(/\.(mbz|imscc)$/i, '')
}

/** Icon für Materialvorschau (Font Awesome solid). */
export function materialVorschauIcon(
  materialType: MaterialType | string | null | undefined,
  fileName?: string | null,
): string {
  if (istMoodleKursMaterial(materialType) || istMoodleBackupDatei(fileName)) {
    return 'graduation-cap'
  }
  if (istH5pMaterial(materialType) || istH5pDatei(fileName)) {
    return materialTypes.icon('h5p') ?? 'puzzle-piece'
  }
  return 'file'
}

/** Beschreibungstext aus Kursarchiv-Metadaten für das Material. */
export function mbzBeschreibung(meta: MbzMetadata): string {
  const zeilen: string[] = []
  if (meta.shortName) zeilen.push(`Kurzname: ${meta.shortName}`)
  if (meta.archiveFormat === 'imscc') {
    if (meta.cartridgeVersion) zeilen.push(`IMS Common Cartridge ${meta.cartridgeVersion}`)
  } else if (meta.moodleRelease) {
    zeilen.push(`Moodle ${meta.moodleRelease}`)
  } else if (meta.moodleVersion) {
    zeilen.push(`Moodle-Version ${meta.moodleVersion}`)
  }
  if (meta.courseFormat) zeilen.push(`Kursformat: ${meta.courseFormat}`)
  if (meta.backupDate) zeilen.push(`Backup vom ${meta.backupDate}`)
  if (meta.summary) {
    zeilen.push('')
    zeilen.push(meta.summary)
  }
  zeilen.push('')
  if (meta.archiveFormat === 'imscc') {
    zeilen.push(
      'Als IMS Common Cartridge (.imscc) in Moodle oder einem kompatiblen LMS importieren.',
    )
  } else {
    zeilen.push(
      'Im SchulMoodle unter Website-Administration → Kurse → Wiederherstellen hochladen.',
    )
  }
  return zeilen.join('\n').trim()
}

/** Vorschlag für Variantenbezeichnung / Schuljahr. */
export function mbzVariantenLabel(meta: MbzMetadata, fallbackDatei?: string): string {
  if (meta.backupDate) {
    const jahr = meta.backupDate.slice(0, 4)
    const monat = Number(meta.backupDate.slice(5, 7))
    if (jahr && monat >= 1 && monat <= 12) {
      const sjStart = monat >= 8 ? Number(jahr) : Number(jahr) - 1
      return `${sjStart}/${String((sjStart + 1) % 100).padStart(2, '0')}`
    }
    return jahr
  }
  const basis = meta.shortName ?? meta.fullName ?? kursarchivDateinameOhneEndung(fallbackDatei)
  return basis?.slice(0, 80) ?? 'Kursversion'
}
