import {
  normalizeGradeLevel,
  normalizeGradeLevels,
  type GradeLevel,
} from './jahrgangsstufen'

export type BulkFolderRole =
  | 'kopiervorlagen'
  | 'klausuren'
  | 'abbildungen'
  | 'gefaehrdungsbeurteilung'
  | 'versuche'
  | 'sonstiges'

export type BulkFileRole = 'schueler' | 'loesung' | 'einzeln' | 'abbildung' | 'anhaengsel'

export const BULK_FOLDER_ROLE_LABELS: Record<BulkFolderRole, string> = {
  kopiervorlagen: 'Kopiervorlagen',
  klausuren: 'Klausuren',
  abbildungen: 'Abbildungen',
  gefaehrdungsbeurteilung: 'Gefährdungsbeurteilungen',
  versuche: 'Versuche',
  sonstiges: 'Weitere Dateien',
}

export const BULK_FILE_ROLE_LABELS: Record<BulkFileRole, string> = {
  schueler: 'Schülerfassung',
  loesung: 'Lösung',
  einzeln: 'Eigenes Material',
  abbildung: 'Abbildung',
  anhaengsel: 'Anhang',
}

/** Mehrfachauswahl; `gradeLevel` nur noch für ältere Stapel-Läufe. */
export function resolveBulkGradeLevels(mapping: {
  gradeLevels?: GradeLevel[] | null
  gradeLevel?: GradeLevel | number | string | null
}): GradeLevel[] {
  if (mapping.gradeLevels !== undefined && mapping.gradeLevels !== null) {
    return normalizeGradeLevels(mapping.gradeLevels)
  }
  const one = normalizeGradeLevel(mapping.gradeLevel)
  return one ? [one] : []
}
