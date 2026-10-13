import { getTableColumns } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import {
  competencies,
  learningGroups,
  lessonCompetencies,
  lessonMaterials,
  lessonPhaseMaterials,
  lessonPhases,
  lessons,
  lessonTags,
  materialAssets,
  materialCompetencies,
  materialGradeLevels,
  materialLearningGroups,
  materialRelations,
  materials,
  materialSubjects,
  materialTags,
  materialTopics,
  materialVariants,
  series,
  seriesCompetencies,
  seriesMaterials,
  seriesTags,
  subjects,
  tags,
  topics,
} from '../../database/schema'

/**
 * Tabellen, die eine Sicherung vollständig enthält – Zeilen werden mit allen
 * Spalten übernommen, damit neue Felder ohne Formatänderung mitwandern.
 *
 * Bewusst nicht enthalten: Benutzerkonten und Sitzungen, Einstellungen
 * (API-Schlüssel sind instanzgebunden verschlüsselt), Freigabe-Links,
 * KI-Protokolle, Importhistorie und Suchindex (wird neu aufgebaut).
 */
export const SICHERUNG_TABELLEN = {
  subjects,
  learningGroups,
  topics,
  tags,
  competencies,
  materials,
  materialVariants,
  materialAssets,
  materialRelations,
  materialSubjects,
  materialTopics,
  materialTags,
  materialCompetencies,
  materialGradeLevels,
  materialLearningGroups,
  series,
  seriesMaterials,
  seriesTags,
  seriesCompetencies,
  lessons,
  lessonPhases,
  lessonMaterials,
  lessonPhaseMaterials,
  lessonTags,
  lessonCompetencies,
} as const satisfies Record<string, PgTable>

export type TabellenName = keyof typeof SICHERUNG_TABELLEN
export type Zeile = Record<string, unknown>

export interface SicherungsBenutzer {
  id: string
  email: string
  name: string
}

export interface SicherungsDaten {
  format: string
  version: number
  erstelltAm: string
  saruVersion: string | null
  exportiertVon: string | null
  /** Nur Name und E-Mail der Besitzer – keine Konten, keine Passwörter. */
  benutzer: SicherungsBenutzer[]
  tabellen: Record<TabellenName, Zeile[]>
}

/** Spalte im Archiv statt `storageKey`: Pfad der Datei innerhalb der ZIP. */
export const ARCHIV_PFAD = 'archivPfad'

/**
 * Bereitet eine Zeile aus dem JSON für ein Insert vor: unbekannte Felder
 * (z. B. aus neueren Versionen) fallen weg, Zeitstempel werden wieder zu Date.
 */
export function zeileFuerInsert<T extends PgTable>(
  tabelle: T,
  zeile: Zeile,
  ueberschreiben: Zeile = {},
): T['$inferInsert'] {
  const spalten = getTableColumns(tabelle) as Record<string, { columnType: string; generated?: unknown }>
  const ergebnis: Zeile = {}
  for (const [schluessel, spalte] of Object.entries(spalten)) {
    if (spalte.generated) continue
    const wert = schluessel in ueberschreiben ? ueberschreiben[schluessel] : zeile[schluessel]
    if (wert === undefined) continue
    ergebnis[schluessel] =
      spalte.columnType === 'PgTimestamp' && typeof wert === 'string' ? new Date(wert) : wert
  }
  return ergebnis as T['$inferInsert']
}
