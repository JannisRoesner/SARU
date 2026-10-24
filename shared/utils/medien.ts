/**
 * Kurze Filme, Animationen und interaktive Inhalte im Stapel: Jede Datei wird ein eigenes
 * Material. Eine optionale `videos.json` im selben Ordner liefert Titel, Beschreibung und die
 * Arbeitsblätter, auf die sich der Film bezieht – daraus entstehen Verknüpfungen „Bezieht sich auf“,
 * die an beiden Materialien sichtbar sind.
 */

export const MEDIEN_MANIFEST_NAME = 'videos.json'
export const MEDIEN_MANIFEST_MAX_BYTES = 2 * 1024 * 1024
export const MEDIEN_MANIFEST_VERSION = 1

export function istMedienManifest(dateiName: string | null | undefined): boolean {
  return ((dateiName ?? '').replace(/\\/g, '/').split('/').pop() ?? '').toLowerCase() === MEDIEN_MANIFEST_NAME
}

export interface MedienManifestEintrag {
  datei: string
  titel: string | null
  beschreibung: string | null
  /** Pfade relativ zum Paket-Wurzelordner, z. B. „Arbeitsblätter/AB6 - Film.pdf“. */
  bezug: string[]
}

export interface MedienManifestErgebnis {
  eintraege: MedienManifestEintrag[]
  fehler: string[]
  warnungen: string[]
}

function text(wert: unknown, max: number): string | null {
  if (typeof wert !== 'string') return null
  const bereinigt = wert.replace(/\s+/g, ' ').trim()
  return bereinigt ? bereinigt.slice(0, max) : null
}

export function parseMedienManifest(roh: string): MedienManifestErgebnis {
  const warnungen: string[] = []
  let json: unknown
  try {
    json = JSON.parse(roh.replace(/^\uFEFF/, ''))
  } catch (error) {
    const grund = error instanceof Error ? error.message : 'unbekannter Fehler'
    return { eintraege: [], fehler: [`videos.json ist kein gültiges JSON (${grund}).`], warnungen }
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { eintraege: [], fehler: ['videos.json muss ein JSON-Objekt sein.'], warnungen }
  }
  const daten = json as Record<string, unknown>
  const version = daten.version === undefined ? MEDIEN_MANIFEST_VERSION : Number(daten.version)
  if (!Number.isInteger(version) || version < 1 || version > MEDIEN_MANIFEST_VERSION) {
    return { eintraege: [], fehler: [`videos.json: Version ${String(daten.version)} wird nicht unterstützt (erwartet: 1).`], warnungen }
  }
  if (!Array.isArray(daten.videos)) {
    return { eintraege: [], fehler: ['videos.json: „videos“ muss eine Liste sein.'], warnungen }
  }
  const eintraege: MedienManifestEintrag[] = []
  const gesehen = new Set<string>()
  daten.videos.forEach((roh, index) => {
    const e = roh && typeof roh === 'object' && !Array.isArray(roh) ? (roh as Record<string, unknown>) : null
    const datei = text(e?.datei, 300)
    if (!e || !datei) {
      warnungen.push(`videos.json: Eintrag ${index + 1} hat kein Feld „datei“ und wird ignoriert.`)
      return
    }
    if (gesehen.has(datei.toLowerCase())) {
      warnungen.push(`videos.json: „${datei}“ ist mehrfach eingetragen – nur der erste Eintrag zählt.`)
      return
    }
    gesehen.add(datei.toLowerCase())
    const bezugRoh = Array.isArray(e.bezug) ? e.bezug : typeof e.bezug === 'string' ? [e.bezug] : []
    eintraege.push({
      datei,
      titel: text(e.titel, 300),
      beschreibung: text(e.beschreibung, 2000),
      bezug: bezugRoh.map((b) => text(b, 500)).filter((b): b is string => Boolean(b)),
    })
  })
  return { eintraege, fehler: [], warnungen }
}

function falten(wert: string): string {
  return wert
    .normalize('NFC')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Findet die Datei zu einem Bezugspfad. Der Pfad ist relativ zum Paket-Wurzelordner; weil ZIPs
 * oft einen zusätzlichen Wurzelordner tragen, passt auch ein Pfad, auf den der Dateipfad endet.
 * Bei mehreren Treffern gewinnt der kürzeste Pfad; `mehrdeutig` meldet das für eine Warnung.
 */
export function findeBezug<T extends { pfad: string }>(bezug: string, dateien: readonly T[]): { treffer: T | null; mehrdeutig: boolean } {
  const ziel = falten(bezug)
  if (!ziel) return { treffer: null, mehrdeutig: false }
  const passende = dateien
    .filter((datei) => {
      const pfad = falten(datei.pfad)
      return pfad === ziel || pfad.endsWith(`/${ziel}`)
    })
    .sort((a, b) => a.pfad.length - b.pfad.length)
  return { treffer: passende[0] ?? null, mehrdeutig: passende.length > 1 }
}
