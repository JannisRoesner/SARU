export type BulkFolderRole =
  | 'kopiervorlagen'
  | 'klausuren'
  | 'abbildungen'
  | 'gefaehrdungsbeurteilung'
  | 'versuche'
  | 'sonstiges'

export type BulkFileRole = 'schueler' | 'loesung' | 'einzeln' | 'anhaengsel'

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
  anhaengsel: 'Anhang',
}
