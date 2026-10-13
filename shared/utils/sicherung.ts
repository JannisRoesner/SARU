/**
 * Gemeinsame Typen und Auswahllogik für Sicherung und Wiederherstellung.
 * Server (Import) und Oberfläche (Vorschau) berechnen den Umfang einer Auswahl
 * mit denselben Funktionen, damit die angezeigte Zusammenfassung stimmt.
 */

export const SICHERUNG_FORMAT = 'saru-export'
export const SICHERUNG_VERSION = 1
export const SICHERUNG_DATEN = 'saru-export.json'
export const SICHERUNG_ADAPTER_ID = 'saru-sicherung'

export type DublettenArt =
  /** Derselbe Datensatz (gleiche ID) existiert bereits – wird nie doppelt angelegt. */
  | 'gleiche_id'
  /** Inhaltlich gleich (gleiche Dateien bzw. gleicher Titel und Termin) – wird standardmäßig verknüpft. */
  | 'gleicher_inhalt'

export interface Dublette {
  art: DublettenArt
  zielId: string
  titel: string
}

export interface AnalyseMaterial {
  titel: string
  typ: string
  dateien: number
  bytes: number
  dublette: Dublette | null
}

export interface AnalyseStunde {
  titel: string
  dublette: Dublette | null
}

export type EintragArt = 'lehrwerk' | 'reihe' | 'stunde' | 'material'

/** Ein auswählbarer Eintrag der Vorschau; Abhängigkeiten sind bereits aufgelöst. */
export interface AnalyseEintrag {
  id: string
  art: EintragArt
  titel: string
  untertitel: string | null
  /** Der Eintrag selbst und alles, was er mitbringt. */
  materialIds: string[]
  stundenIds: string[]
  reihenIds: string[]
}

export interface SicherungAnalyse {
  runId: string
  dateiName: string
  dateiGroesse: number
  erstelltAm: string | null
  exportiertVon: string | null
  saruVersion: string | null
  warnungen: string[]
  eintraege: AnalyseEintrag[]
  materialien: Record<string, AnalyseMaterial>
  stunden: Record<string, AnalyseStunde>
  reihen: Record<string, AnalyseStunde>
}

export interface ImportAuswahl {
  eintraege: string[]
  /** Inhaltsgleiche Materialien, Stunden und Reihen trotzdem neu anlegen. */
  inhaltsgleicheAnlegen: boolean
}

export interface AuswahlUmfang {
  materialIds: Set<string>
  stundenIds: Set<string>
  reihenIds: Set<string>
}

export interface AuswahlZusammenfassung {
  materialien: number
  stunden: number
  reihen: number
  dateien: number
  bytes: number
  /** Übersprungen bzw. mit Vorhandenem verknüpft. */
  vorhanden: number
}

/** Alles, was eine Auswahl umfasst – inklusive mitgebrachter Abhängigkeiten. */
export function auswahlUmfang(analyse: Pick<SicherungAnalyse, 'eintraege'>, ids: Iterable<string>): AuswahlUmfang {
  const gewaehlt = new Set(ids)
  const umfang: AuswahlUmfang = { materialIds: new Set(), stundenIds: new Set(), reihenIds: new Set() }
  for (const eintrag of analyse.eintraege) {
    if (!gewaehlt.has(eintrag.id)) continue
    for (const id of eintrag.materialIds) umfang.materialIds.add(id)
    for (const id of eintrag.stundenIds) umfang.stundenIds.add(id)
    for (const id of eintrag.reihenIds) umfang.reihenIds.add(id)
  }
  return umfang
}

/** Wird dieser Datensatz neu angelegt oder auf Vorhandenes abgebildet? */
export function wirdAngelegt(dublette: Dublette | null | undefined, inhaltsgleicheAnlegen: boolean): boolean {
  if (!dublette) return true
  return dublette.art === 'gleicher_inhalt' && inhaltsgleicheAnlegen
}

export function auswahlZusammenfassen(
  analyse: Pick<SicherungAnalyse, 'eintraege' | 'materialien' | 'stunden' | 'reihen'>,
  auswahl: ImportAuswahl,
): AuswahlZusammenfassung {
  const umfang = auswahlUmfang(analyse, auswahl.eintraege)
  const ergebnis: AuswahlZusammenfassung = { materialien: 0, stunden: 0, reihen: 0, dateien: 0, bytes: 0, vorhanden: 0 }

  for (const id of umfang.materialIds) {
    const material = analyse.materialien[id]
    if (!material) continue
    if (!wirdAngelegt(material.dublette, auswahl.inhaltsgleicheAnlegen)) {
      ergebnis.vorhanden += 1
      continue
    }
    ergebnis.materialien += 1
    ergebnis.dateien += material.dateien
    ergebnis.bytes += material.bytes
  }
  for (const id of umfang.stundenIds) {
    if (wirdAngelegt(analyse.stunden[id]?.dublette, auswahl.inhaltsgleicheAnlegen)) ergebnis.stunden += 1
    else ergebnis.vorhanden += 1
  }
  for (const id of umfang.reihenIds) {
    if (wirdAngelegt(analyse.reihen[id]?.dublette, auswahl.inhaltsgleicheAnlegen)) ergebnis.reihen += 1
    else ergebnis.vorhanden += 1
  }
  return ergebnis
}

/** Ein Eintrag lohnt sich, wenn mindestens ein Teil davon neu ist. */
export function eintragHatNeues(
  analyse: Pick<SicherungAnalyse, 'materialien' | 'stunden' | 'reihen'>,
  eintrag: AnalyseEintrag,
  inhaltsgleicheAnlegen = false,
): boolean {
  return (
    eintrag.materialIds.some((id) => wirdAngelegt(analyse.materialien[id]?.dublette, inhaltsgleicheAnlegen)) ||
    eintrag.stundenIds.some((id) => wirdAngelegt(analyse.stunden[id]?.dublette, inhaltsgleicheAnlegen)) ||
    eintrag.reihenIds.some((id) => wirdAngelegt(analyse.reihen[id]?.dublette, inhaltsgleicheAnlegen))
  )
}

// --- Ordnerstruktur im Archiv -----------------------------------------------------

/** Macht aus einem Titel einen gültigen Ordner- oder Dateinamen (auch unter Windows). */
export function pfadSegment(name: string | null | undefined, ersatz = 'Ohne Titel', maxLaenge = 80): string {
  const bereinigt = (name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLaenge)
    .replace(/[\s.]+$/, '')
    .replace(/^[\s.]+/, '')
  return bereinigt || ersatz
}

/** Hängt „ (2)“, „ (3)“ … an, bis der Name innerhalb des Ordners frei ist. */
export function freierName(name: string, belegt: Set<string>, endung = ''): string {
  let kandidat = `${name}${endung}`
  for (let i = 2; belegt.has(kandidat.toLowerCase()); i += 1) kandidat = `${name} (${i})${endung}`
  belegt.add(kandidat.toLowerCase())
  return kandidat
}
