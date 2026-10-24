import type { MaterialType } from '../types/domain'

/**
 * Abbildungssammlungen: ein Material mit vielen Einzelbildern (z. B. alle Grafiken eines
 * Schulbuch-Kapitels von einer Verlags-CD). Hier liegt die reine Logik – Formaterkennung,
 * Lesen von `abbildungen.json`, Ableitungen aus Dateinamen und die Zuordnung von Varianten –,
 * damit Stapel-Upload, Upload in eine bestehende Sammlung und die Oberfläche dieselben Regeln nutzen.
 */

/** Name der optionalen Beschreibungsdatei im Abbildungsordner. */
export const ABBILDUNGEN_MANIFEST_NAME = 'abbildungen.json'
/** Höchstgröße der Beschreibungsdatei – schützt vor versehentlich riesigen Dateien. */
export const ABBILDUNGEN_MANIFEST_MAX_BYTES = 8 * 1024 * 1024
export const ABBILDUNGEN_MANIFEST_VERSION = 1

/** Bildformate, die in eine Abbildungssammlung übernommen werden. */
export const ABBILDUNG_BILD_ERWEITERUNGEN = ['png', 'jpg', 'jpeg', 'webp', 'gif'] as const
/**
 * Bildformate, die bewusst abgelehnt werden: Browser zeigen TIFF/BMP nicht an und die
 * Miniaturerzeugung (Skia) kann sie nicht lesen. Sie müssen vor dem Upload gewandelt werden.
 */
export const ABBILDUNG_ABGELEHNTE_ERWEITERUNGEN = ['tif', 'tiff', 'bmp'] as const
/** Kurze Videos, die im Stapel als eigenes Material „Video“ angelegt werden. */
export const VIDEO_ERWEITERUNGEN = ['mp4', 'm4v', 'webm'] as const

/** Höchstzahl Schlagwörter je Bild. */
export const MAX_SCHLAGWOERTER = 20

export type AbbildungHerkunft = 'paket' | 'dateiname' | 'ki' | 'bearbeitet'

function endung(dateiName: string | null | undefined): string {
  const name = (dateiName ?? '').split(/[\\/]/).pop() ?? ''
  const punkt = name.lastIndexOf('.')
  return punkt > 0 ? name.slice(punkt + 1).toLowerCase() : ''
}

function basisname(pfad: string): string {
  return pfad.replace(/\\/g, '/').split('/').pop() ?? pfad
}

function stammVon(dateiName: string): string {
  return basisname(dateiName).replace(/\.[^.]+$/, '')
}

function falten(wert: string): string {
  return wert
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

export function istAbbildungsBildDatei(dateiName: string | null | undefined): boolean {
  return (ABBILDUNG_BILD_ERWEITERUNGEN as readonly string[]).includes(endung(dateiName))
}

export function istAbgelehntesBildformat(dateiName: string | null | undefined): boolean {
  return (ABBILDUNG_ABGELEHNTE_ERWEITERUNGEN as readonly string[]).includes(endung(dateiName))
}

export function istVideoDatei(dateiName: string | null | undefined): boolean {
  return (VIDEO_ERWEITERUNGEN as readonly string[]).includes(endung(dateiName))
}

export function istAbbildungenManifest(dateiName: string | null | undefined): boolean {
  return basisname(dateiName ?? '').toLowerCase() === ABBILDUNGEN_MANIFEST_NAME
}

export function istAbbildungssammlungMaterial(
  type: MaterialType | string | null | undefined,
): type is 'abbildungssammlung' {
  return type === 'abbildungssammlung'
}

/**
 * Liegt die Datei in einem Abbildungsordner? Maßgeblich sind nur die Ordner im Pfad, nicht der
 * Dateiname: `Biologie 1/Abbildungen/Cytologie/S012 Abb 1b.jpg` ja, `Kopiervorlagen/abbildung.png` nein.
 */
export function istInAbbildungsOrdner(pfad: string | null | undefined): boolean {
  const teile = (pfad ?? '').replace(/\\/g, '/').split('/').filter(Boolean)
  return teile.slice(0, -1).some((ordner) => /abbildung|abbsb|abbsvb/.test(falten(ordner)))
}

/** Ordnerpfad einer Datei (ohne Dateiname), mit `/` getrennt. */
export function ordnerPfadVon(pfad: string): string {
  const teile = pfad.replace(/\\/g, '/').split('/').filter(Boolean)
  return teile.slice(0, -1).join('/')
}

/** Vergleichsschlüssel für Dateinamen aus JSON und Paket (Groß/klein, Unicode-Form, Sonderzeichen). */
export function dateiSchluessel(name: string): string {
  return basisname(name)
    .normalize('NFC')
    // Dieselben Zeichen, die der Server beim Speichern aus Dateinamen entfernt.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// --- Metadaten ----------------------------------------------------------------

export interface AbbildungMetadaten {
  titel: string | null
  beschreibung: string | null
  werk: string | null
  /** Seitenangabe als Text („12“, „12–13“). */
  seite: string | null
  abbildung: string | null
  kapitel: string | null
  schlagwoerter: string[]
  /** `null` = unbekannt. */
  beschriftet: boolean | null
  /** Herkunftspfad auf der Original-CD. */
  original: string | null
}

export function leereAbbildungMetadaten(): AbbildungMetadaten {
  return {
    titel: null,
    beschreibung: null,
    werk: null,
    seite: null,
    abbildung: null,
    kapitel: null,
    schlagwoerter: [],
    beschriftet: null,
    original: null,
  }
}

function text(wert: unknown, max: number): string | null {
  if (typeof wert === 'number' && Number.isFinite(wert)) return String(wert)
  if (typeof wert !== 'string') return null
  const bereinigt = wert.replace(/\s+/g, ' ').trim()
  return bereinigt ? bereinigt.slice(0, max) : null
}

export function normalisiereSchlagwoerter(wert: unknown): string[] {
  const liste = Array.isArray(wert)
    ? wert
    : typeof wert === 'string'
      ? wert.split(/[,;]/)
      : []
  const gesehen = new Set<string>()
  const ergebnis: string[] = []
  for (const eintrag of liste) {
    const wort = text(eintrag, 120)
    if (!wort || gesehen.has(wort.toLowerCase())) continue
    gesehen.add(wort.toLowerCase())
    ergebnis.push(wort)
    if (ergebnis.length >= MAX_SCHLAGWOERTER) break
  }
  return ergebnis
}

/** Endung, die eine unbeschriftete Variante kennzeichnet („… - unbeschriftet“, „…_ohne Beschriftung“). */
const UNBESCHRIFTET = /[\s._-]*(?:\(\s*)?(?:unbeschriftet|ohne[\s_-]+beschriftung|stumm)(?:\s*\))?$/i
const BESCHRIFTET = /(?:[\s._-]+\(?|\s*\()beschriftet\)?$/i

/** Bausteine für Dateinamen wie „S012 Abb 1b - Titel“ / „Seite 12-13 - Titel“ / „Abb. 3 Titel“. */
const SEITE = String.raw`S(?:eite)?\.?\s*(\d{1,4}(?:\s*[-–]\s*\d{1,4})?)`
const ABB = String.raw`Abb(?:ildung)?\.?\s*([0-9]{1,3}[a-z]?)`
const TRENNER = String.raw`(?:\s*[-–—_]\s*|\s+)`

/** „012“ → „12“, „12-13“ → „12–13“. */
function seitenText(roh: string): string {
  const [von, bis] = roh.split(/\s*[-–]\s*/)
  const anfang = Number.parseInt(von ?? '', 10)
  const ende = bis ? Number.parseInt(bis, 10) : Number.NaN
  return Number.isFinite(ende) ? `${anfang}–${ende}` : String(anfang)
}

/** Stamm ohne Varianten-Endung – Hauptbild und unbeschriftete Fassung fallen so zusammen. */
export function variantenStamm(dateiName: string): { stamm: string; unbeschriftet: boolean } {
  const stamm = stammVon(dateiName).trim()
  if (UNBESCHRIFTET.test(stamm)) {
    const rest = stamm.replace(UNBESCHRIFTET, '').trim()
    if (rest) return { stamm: rest, unbeschriftet: true }
  }
  return { stamm, unbeschriftet: false }
}

/**
 * Leitet Titel, Seite und Abbildungsnummer aus dem Dateinamen ab, z. B.
 * „S012 Abb 1b - Pflanzenzelle im Lichtmikroskop - unbeschriftet.png“ →
 * Seite 12, Abb. 1b, Titel „Pflanzenzelle im Lichtmikroskop“, unbeschriftet.
 */
export function abbildungAusDateiname(dateiName: string): AbbildungMetadaten {
  const { stamm, unbeschriftet } = variantenStamm(dateiName)
  const meta = leereAbbildungMetadaten()
  let rest = stamm
  if (unbeschriftet) {
    meta.beschriftet = false
  } else if (BESCHRIFTET.test(stamm) && stamm.replace(BESCHRIFTET, '').trim()) {
    meta.beschriftet = true
    rest = stamm.replace(BESCHRIFTET, '').trim()
  }

  const mitAbb = new RegExp(`^${SEITE}[\\s_-]+${ABB}${TRENNER}(.*)$`, 'i').exec(rest)
  const nurSeite = new RegExp(`^${SEITE}${TRENNER}(.*)$`, 'i').exec(rest)
  const nurAbb = new RegExp(`^${ABB}${TRENNER}(.*)$`, 'i').exec(rest)
  if (mitAbb) {
    meta.seite = seitenText(mitAbb[1]!)
    meta.abbildung = mitAbb[2]!.toLowerCase()
    rest = mitAbb[3]!.trim()
  } else if (nurSeite) {
    meta.seite = seitenText(nurSeite[1]!)
    rest = nurSeite[2]!.trim()
  } else if (nurAbb) {
    meta.abbildung = nurAbb[1]!.toLowerCase()
    rest = nurAbb[2]!.trim()
  }

  const titel = rest.replace(/^[-–—_\s]+/, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim()
  meta.titel = titel || stamm.replace(/_+/g, ' ').trim() || null
  return meta
}

// --- abbildungen.json -----------------------------------------------------------

export interface AbbildungManifestEintrag extends Partial<AbbildungMetadaten> {
  datei: string
  /**
   * `datei`-Name des Hauptbildes. `undefined` = nicht angegeben (dann gilt die Namensregel
   * „… - unbeschriftet“), `null` = ausdrücklich ein Hauptbild.
   */
  varianteVon?: string | null
}

export interface AbbildungManifest {
  version: number
  titel: string | null
  beschreibung: string | null
  quelle: string | null
  bilder: AbbildungManifestEintrag[]
}

export interface ManifestErgebnis {
  manifest: AbbildungManifest | null
  /** Schwere Fehler: die Datei wird nicht verwendet. */
  fehler: string[]
  /** Einzelne Einträge ignoriert oder korrigiert. */
  warnungen: string[]
}

/** Liest `abbildungen.json` tolerant: unbekannte Felder werden ignoriert, Typen vorsichtig gewandelt. */
export function parseAbbildungenManifest(roh: string): ManifestErgebnis {
  const fehler: string[] = []
  const warnungen: string[] = []
  let json: unknown
  try {
    json = JSON.parse(roh.replace(/^\uFEFF/, ''))
  } catch (error) {
    const grund = error instanceof Error ? error.message : 'unbekannter Fehler'
    return { manifest: null, fehler: [`abbildungen.json ist kein gültiges JSON (${grund}).`], warnungen }
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { manifest: null, fehler: ['abbildungen.json muss ein JSON-Objekt sein.'], warnungen }
  }
  const daten = json as Record<string, unknown>
  const version = daten.version === undefined ? ABBILDUNGEN_MANIFEST_VERSION : Number(daten.version)
  if (!Number.isInteger(version) || version < 1) {
    fehler.push('abbildungen.json: „version“ muss eine ganze Zahl ab 1 sein.')
  } else if (version > ABBILDUNGEN_MANIFEST_VERSION) {
    fehler.push(
      `abbildungen.json hat Version ${version}; unterstützt wird Version ${ABBILDUNGEN_MANIFEST_VERSION}.`,
    )
  }
  if (!Array.isArray(daten.bilder)) {
    fehler.push('abbildungen.json: „bilder“ muss eine Liste sein.')
  }
  if (fehler.length) return { manifest: null, fehler, warnungen }

  const bilder: AbbildungManifestEintrag[] = []
  const gesehen = new Set<string>()
  ;(daten.bilder as unknown[]).forEach((eintrag, index) => {
    if (!eintrag || typeof eintrag !== 'object' || Array.isArray(eintrag)) {
      warnungen.push(`abbildungen.json: Eintrag ${index + 1} ist kein Objekt und wird ignoriert.`)
      return
    }
    const e = eintrag as Record<string, unknown>
    const datei = text(e.datei, 300)
    if (!datei) {
      warnungen.push(`abbildungen.json: Eintrag ${index + 1} hat kein Feld „datei“ und wird ignoriert.`)
      return
    }
    const schluessel = dateiSchluessel(datei)
    if (gesehen.has(schluessel)) {
      warnungen.push(`abbildungen.json: „${datei}“ ist mehrfach eingetragen – nur der erste Eintrag zählt.`)
      return
    }
    gesehen.add(schluessel)
    const varianteRoh = e.variante_von ?? e.varianteVon
    bilder.push({
      datei,
      titel: text(e.titel, 300),
      beschreibung: text(e.beschreibung, 4000),
      werk: text(e.werk, 200),
      seite: text(e.seite, 40),
      abbildung: text(e.abbildung, 40),
      kapitel: text(e.kapitel, 200),
      schlagwoerter: normalisiereSchlagwoerter(e.schlagwoerter),
      beschriftet: typeof e.beschriftet === 'boolean' ? e.beschriftet : null,
      original: text(e.original, 500),
      varianteVon:
        'variante_von' in e || 'varianteVon' in e
          ? typeof varianteRoh === 'string' && varianteRoh.trim()
            ? varianteRoh.trim()
            : null
          : undefined,
    })
  })

  return {
    manifest: {
      version,
      titel: text(daten.titel, 300),
      beschreibung: text(daten.beschreibung, 4000),
      quelle: text(daten.quelle, 500),
      bilder,
    },
    fehler,
    warnungen,
  }
}

// --- Planung einer Sammlung -------------------------------------------------------

export interface AbbildungPlanDatei {
  /** Kennung im Stapel (sourceRef) bzw. im Upload. */
  ref: string
  dateiName: string
}

export interface AbbildungPlanEintrag {
  ref: string
  dateiName: string
  /** Position in der Sammlung (0-basiert). */
  reihenfolge: number
  metadaten: AbbildungMetadaten
  /** Hauptbild, wenn dies eine Variante ist (z. B. unbeschriftet). */
  varianteVonRef: string | null
  herkunft: Extract<AbbildungHerkunft, 'paket' | 'dateiname'>
}

export interface AbbildungssammlungPlan {
  titel: string | null
  beschreibung: string | null
  quelle: string | null
  manifestGefunden: boolean
  eintraege: AbbildungPlanEintrag[]
  /** Bilder ohne Angaben aus dem Paket (Kandidaten für die KI). */
  ohneAngaben: number
  varianten: number
  warnungen: string[]
}

const sortierer = new Intl.Collator('de', { numeric: true, sensitivity: 'base' })

/** Höchstens so viele Dateinamen werden in einer Sammelwarnung aufgezählt. */
const MAX_NAMEN_IN_WARNUNG = 5

function namensliste(namen: string[]): string {
  const sichtbar = namen.slice(0, MAX_NAMEN_IN_WARNUNG).map((n) => `„${n}“`).join(', ')
  return namen.length > MAX_NAMEN_IN_WARNUNG ? `${sichtbar} und ${namen.length - MAX_NAMEN_IN_WARNUNG} weitere` : sichtbar
}

/**
 * Ordnet Bilder eines Ordners zu einer Sammlung: Angaben aus `abbildungen.json` haben Vorrang,
 * fehlende Felder kommen aus dem Dateinamen. Varianten (`variante_von`, sonst Namensendung
 * „- unbeschriftet“) hängen an ihrem Hauptbild; Ketten werden auf das Hauptbild verkürzt.
 */
export function planeAbbildungssammlung(
  dateien: AbbildungPlanDatei[],
  manifest: AbbildungManifest | null,
): AbbildungssammlungPlan {
  const warnungen: string[] = []
  const nachSchluessel = new Map<string, AbbildungPlanDatei>()
  for (const datei of dateien) {
    const schluessel = dateiSchluessel(datei.dateiName)
    if (nachSchluessel.has(schluessel)) {
      warnungen.push(`„${datei.dateiName}“ liegt doppelt im Ordner – nur eine Datei wird übernommen.`)
      continue
    }
    nachSchluessel.set(schluessel, datei)
  }

  // Reihenfolge: zuerst wie in abbildungen.json, danach die übrigen Bilder nach Namen.
  const manifestNachSchluessel = new Map<string, AbbildungManifestEintrag>()
  const fehlend: string[] = []
  const reihenfolge: AbbildungPlanDatei[] = []
  for (const eintrag of manifest?.bilder ?? []) {
    const schluessel = dateiSchluessel(eintrag.datei)
    const datei = nachSchluessel.get(schluessel)
    if (!datei) {
      fehlend.push(eintrag.datei)
      continue
    }
    manifestNachSchluessel.set(schluessel, eintrag)
    reihenfolge.push(datei)
  }
  const ohneEintrag = [...nachSchluessel.values()]
    .filter((datei) => !manifestNachSchluessel.has(dateiSchluessel(datei.dateiName)))
    .sort((a, b) => sortierer.compare(a.dateiName, b.dateiName))
  reihenfolge.push(...ohneEintrag)

  if (fehlend.length) {
    warnungen.push(
      `abbildungen.json nennt ${fehlend.length} Datei${fehlend.length === 1 ? '' : 'en'}, die im Ordner fehl${fehlend.length === 1 ? 't' : 'en'}: ${namensliste(fehlend)}.`,
    )
  }
  if (manifest && ohneEintrag.length) {
    warnungen.push(
      `${ohneEintrag.length} Bild${ohneEintrag.length === 1 ? '' : 'er'} ohne Eintrag in abbildungen.json – Angaben aus dem Dateinamen: ${namensliste(ohneEintrag.map((d) => d.dateiName))}.`,
    )
  }

  // Varianten zuordnen.
  const refNachSchluessel = new Map([...nachSchluessel].map(([schluessel, datei]) => [schluessel, datei.ref]))
  const refNachStamm = new Map<string, string>()
  for (const datei of reihenfolge) {
    const { stamm, unbeschriftet } = variantenStamm(datei.dateiName)
    if (!unbeschriftet && !refNachStamm.has(falten(stamm))) refNachStamm.set(falten(stamm), datei.ref)
  }
  const elternVon = new Map<string, string | null>()
  for (const datei of reihenfolge) {
    const eintrag = manifestNachSchluessel.get(dateiSchluessel(datei.dateiName))
    if (eintrag && eintrag.varianteVon !== undefined) {
      if (eintrag.varianteVon === null) {
        elternVon.set(datei.ref, null)
        continue
      }
      const ziel = refNachSchluessel.get(dateiSchluessel(eintrag.varianteVon))
      if (!ziel) {
        warnungen.push(
          `„${datei.dateiName}“: variante_von „${eintrag.varianteVon}“ gibt es im Ordner nicht – wird als eigenes Bild übernommen.`,
        )
        elternVon.set(datei.ref, null)
      } else if (ziel === datei.ref) {
        warnungen.push(`„${datei.dateiName}“ ist als Variante von sich selbst eingetragen – ignoriert.`)
        elternVon.set(datei.ref, null)
      } else {
        elternVon.set(datei.ref, ziel)
      }
      continue
    }
    const { stamm, unbeschriftet } = variantenStamm(datei.dateiName)
    const haupt = unbeschriftet ? refNachStamm.get(falten(stamm)) : undefined
    elternVon.set(datei.ref, haupt && haupt !== datei.ref ? haupt : null)
  }
  // Ketten (A → B → C) auf das Hauptbild verkürzen, Kreise auflösen.
  const wurzel = (ref: string): string | null => {
    const besucht = new Set<string>([ref])
    let aktuell = elternVon.get(ref) ?? null
    while (aktuell && elternVon.get(aktuell)) {
      if (besucht.has(aktuell)) return null
      besucht.add(aktuell)
      aktuell = elternVon.get(aktuell) ?? null
    }
    return aktuell && !besucht.has(aktuell) ? aktuell : null
  }
  const kreise: string[] = []
  const varianteVon = new Map<string, string | null>()
  for (const datei of reihenfolge) {
    const direkt = elternVon.get(datei.ref) ?? null
    const ziel = direkt ? wurzel(datei.ref) : null
    if (direkt && !ziel) kreise.push(datei.dateiName)
    varianteVon.set(datei.ref, ziel)
  }
  if (kreise.length) {
    warnungen.push(`Varianten verweisen im Kreis aufeinander (${namensliste(kreise)}) – als eigene Bilder übernommen.`)
  }

  let ohneAngaben = 0
  let varianten = 0
  const eintraege = reihenfolge.map((datei, index): AbbildungPlanEintrag => {
    const ausName = abbildungAusDateiname(datei.dateiName)
    const eintrag = manifestNachSchluessel.get(dateiSchluessel(datei.dateiName))
    const varianteVonRef = varianteVon.get(datei.ref) ?? null
    if (varianteVonRef) varianten += 1
    const metadaten: AbbildungMetadaten = eintrag
      ? {
          titel: eintrag.titel ?? ausName.titel,
          beschreibung: eintrag.beschreibung ?? null,
          werk: eintrag.werk ?? null,
          seite: eintrag.seite ?? ausName.seite,
          abbildung: eintrag.abbildung ?? ausName.abbildung,
          kapitel: eintrag.kapitel ?? null,
          schlagwoerter: eintrag.schlagwoerter ?? [],
          beschriftet: eintrag.beschriftet ?? ausName.beschriftet,
          original: eintrag.original ?? null,
        }
      : ausName
    // Unbeschriftete Varianten zeigen dasselbe Motiv: Angaben vom Hauptbild erben, wenn eigene fehlen.
    const herkunft = eintrag && (eintrag.titel || eintrag.beschreibung) ? 'paket' : 'dateiname'
    if (herkunft === 'dateiname' && !varianteVonRef) ohneAngaben += 1
    return { ref: datei.ref, dateiName: datei.dateiName, reihenfolge: index, metadaten, varianteVonRef, herkunft }
  })

  const nachRef = new Map(eintraege.map((e) => [e.ref, e]))
  for (const e of eintraege) {
    if (!e.varianteVonRef) continue
    const haupt = nachRef.get(e.varianteVonRef)!
    const m = e.metadaten
    if (e.herkunft === 'dateiname') {
      m.titel = haupt.metadaten.titel ?? m.titel
      m.beschreibung = m.beschreibung ?? haupt.metadaten.beschreibung
      m.schlagwoerter = m.schlagwoerter.length ? m.schlagwoerter : [...haupt.metadaten.schlagwoerter]
      if (haupt.herkunft === 'paket') e.herkunft = 'paket'
    }
    m.werk = m.werk ?? haupt.metadaten.werk
    m.seite = m.seite ?? haupt.metadaten.seite
    m.abbildung = m.abbildung ?? haupt.metadaten.abbildung
    m.kapitel = m.kapitel ?? haupt.metadaten.kapitel
  }

  return {
    titel: manifest?.titel ?? null,
    beschreibung: manifest?.beschreibung ?? null,
    quelle: manifest?.quelle ?? null,
    manifestGefunden: Boolean(manifest),
    eintraege,
    ohneAngaben,
    varianten,
    warnungen,
  }
}

/** Titel einer Sammlung aus dem Ordnerpfad: „Biologie 1/Abbildungen/03 Cytologie“ → „Cytologie“. */
export function sammlungsTitelAusOrdner(ordnerPfad: string): string {
  const teile = ordnerPfad.split('/').filter(Boolean)
  const aufraeumen = (name: string) =>
    name.replace(/^\d{1,3}[\s._-]+/, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim()
  const letzter = aufraeumen(teile[teile.length - 1] ?? '')
  // „Abbildungen“ allein sagt nichts – dann den Elternordner dazunehmen.
  if (!letzter || /^(abbildungen?|abbsv?b|bilder)$/i.test(letzter)) {
    const eltern = aufraeumen(teile[teile.length - 2] ?? '')
    return eltern ? `Abbildungen ${eltern}` : 'Abbildungen'
  }
  return /^abbildung/i.test(letzter) ? letzter : `Abbildungen ${letzter}`
}

/** Wählt eine Kurzbeschriftung für Galerie und Suchtreffer: „S. 12 · Abb. 1b“. */
export function abbildungFundstelle(meta: Pick<AbbildungMetadaten, 'seite' | 'abbildung' | 'werk'>): string {
  return [meta.werk, meta.seite ? `S. ${meta.seite}` : null, meta.abbildung ? `Abb. ${meta.abbildung}` : null]
    .filter(Boolean)
    .join(' · ')
}

// --- Stapel-Filter ---------------------------------------------------------------

/**
 * Grund, warum eine Datei mit diesem Pfad im Stapel übersprungen wird, oder `null`, wenn sie
 * zu den Bild-/Video-Regeln passt (andere Formate prüft der Aufrufer selbst).
 */
export function bildUeberspringGrund(pfad: string): string | null {
  if (istAbgelehntesBildformat(pfad)) {
    return 'TIFF/BMP wird nicht unterstützt – bitte vorher in PNG oder JPEG wandeln.'
  }
  if (istAbbildungsBildDatei(pfad) && !istInAbbildungsOrdner(pfad)) {
    return 'Einzelbild außerhalb eines Abbildungsordners.'
  }
  if (istAbbildungenManifest(pfad) && !istInAbbildungsOrdner(pfad)) {
    return 'abbildungen.json außerhalb eines Abbildungsordners.'
  }
  return null
}
