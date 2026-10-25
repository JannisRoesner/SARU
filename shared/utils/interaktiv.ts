import type { MaterialType } from '../types/domain'

/**
 * Interaktive Inhalte: Flash (.swf, per Ruffle) und HTML5-Pakete (.html5.zip). Ein HTML5-Paket ist
 * eine ZIP-Datei mit einer Webseite (HTML, JS, CSS, Bilder …), z. B. Tafelbilder und Medienmodule
 * der Klett-Unterrichtsassistenten. Die doppelte Endung unterscheidet es von gewöhnlichen
 * ZIP-Archiven, die der Stapel entpackt.
 */
export type InteraktivFormat = 'swf' | 'html5'

export const HTML5_PAKET_ENDUNG = '.html5.zip'

export function interaktivFormat(fileName: string | null | undefined): InteraktivFormat | null {
  const name = (fileName ?? '').toLowerCase()
  if (name.endsWith(HTML5_PAKET_ENDUNG)) return 'html5'
  return name.endsWith('.swf') ? 'swf' : null
}

export function istInteraktivDatei(fileName: string | null | undefined): boolean {
  return interaktivFormat(fileName) !== null
}

export function istHtml5PaketDatei(fileName: string | null | undefined): boolean {
  return interaktivFormat(fileName) === 'html5'
}

function pfadTiefe(pfad: string): number {
  return pfad.split('/').length - 1
}

/**
 * Startseite eines HTML5-Pakets: die oberste `index.html`, sonst die einzige HTML-Datei.
 * `null`, wenn es keine gibt oder mehrere gleichrangige in Frage kommen.
 */
export function html5Startseite(eintraege: Iterable<string>): string | null {
  const seiten = [...eintraege]
    .filter((n) => /\.html?$/i.test(n) && !/(^|\/)__macosx\//i.test(n))
    .sort((a, b) => pfadTiefe(a) - pfadTiefe(b) || a.localeCompare(b))
  const index = seiten.filter((n) => /(^|\/)index\.html?$/i.test(n))
  if (index.length > 0) {
    return index.length === 1 || pfadTiefe(index[0]!) < pfadTiefe(index[1]!) ? index[0]! : null
  }
  return seiten.length === 1 ? seiten[0]! : null
}

export function istInteraktivMaterial(
  type: MaterialType | string | null | undefined,
): type is 'interaktiv' {
  return type === 'interaktiv'
}

/** SWF-Tag 77 (Metadata): enthält bei vorbereiteten Animationen ein JSON-Dokument. */
const SWF_TAG_METADATA = 77

export interface InteraktivErklaerung {
  title: string
  text: string
}

/** Wert, der per `swfCall(fn, arg)` an eine Funktion der SWF übergeben wird. */
export type InteraktivArgument = string | number | boolean | null

/**
 * Zusatzknopf in der Steuerleiste (z. B. Director-Schalter „Manuell“ der CD-ROM). Ein Klick ruft
 * `_root[fn](arg)` in der SWF auf. Mit `umschalten` wird der Knopf zum Umschalter: der zweite Klick
 * ruft `fn(umschalten.arg)` auf und zeigt dabei `umschalten.label`.
 */
export interface InteraktivAktion {
  label: string
  fn: string
  /** `undefined`: Aufruf ohne Argument. */
  arg?: InteraktivArgument
  umschalten: { label: string; arg?: InteraktivArgument } | null
}

export interface InteraktivMetadaten {
  title: string | null
  /** Frames, an denen die Animation auf „Weiter“ wartet. */
  stopFrames: number[]
  /** `erklaerungen[i]` gehört zu `stopFrames[i]`. */
  erklaerungen: (InteraktivErklaerung | null)[]
  /** Zusatzknöpfe (optional, leer bei älteren SWFs). */
  aktionen: InteraktivAktion[]
  /** Zeitleisten-Schieber anzeigen (optional, nur wenn ausdrücklich gesetzt). */
  schieber: boolean
  /** Gesamtzahl der Frames für den Schieber; null = aus dem SWF-Kopf nehmen. */
  totalFrames: number | null
  /** Paket-SWF: Hülle mit Start-SWF und Nachbardateien (null bei gewöhnlichen SWFs). */
  paket: InteraktivPaket | null
}

/**
 * Paket-SWF („Bündel“): Die Datei ist nur eine Hülle. Sie enthält die Original-SWF und alle Dateien, die
 * diese nachlädt (SWF, XML, TXT, Bilder, MP3 …), als DefineBinaryData-Tags (87). Der Player startet
 * `start` und beantwortet alle Ladeaufrufe aus dem Paket; relative Pfade gelten gegenüber `basis`
 * (bei Flash im Browser: Ordner der HTML-Seite).
 */
export interface InteraktivPaket {
  /** Paketpfad der Start-SWF (normalisiert, siehe `paketPfad`). */
  start: string
  /** Verzeichnis für relative Pfade, leer oder mit abschließendem „/“. */
  basis: string
  /** FlashVars der Start-SWF. */
  parameter: Record<string, string>
  /**
   * Inhalt auf den Rahmen einpassen, auch wenn die Start-SWF das Skalieren abschaltet (z. B. Cornelsens
   * Flinter). Setzt voraus, dass die Bühnengröße der Start-SWF der gezeichneten Größe entspricht.
   */
  skalieren: boolean
  dateien: InteraktivPaketDatei[]
}

export interface InteraktivPaketDatei {
  /** Normalisierter Paketpfad (Kleinschreibung, „/“, ohne `.`/`..`). */
  pfad: string
  /** Zeichen-ID des DefineBinaryData-Tags. */
  id: number
  typ: string
}

/** Höchstzahl der Paketdateien – schützt vor unsinnigen Manifesten. */
const MAX_PAKET_DATEIEN = 20_000
const SWF_TAG_BINAERDATEN = 87

/**
 * Normalisiert einen Paketpfad bzw. eine relative URL: „\“ → „/“, Abfrage/Anker entfernen,
 * `.`/`..` auflösen, Prozentkodierung lösen, Kleinschreibung (die CD-ROMs waren nicht
 * groß-/kleinschreibungsempfindlich). Pfade oberhalb der Wurzel bleiben an der Wurzel.
 */
export function paketPfad(roh: string): string {
  let pfad = roh.split(/[?#]/)[0] ?? ''
  try {
    pfad = decodeURIComponent(pfad)
  } catch {
    // ungültige Kodierung – Rohtext verwenden
  }
  const teile: string[] = []
  for (const teil of pfad.replace(/\\/g, '/').split('/')) {
    if (!teil || teil === '.') continue
    if (teil === '..') teile.pop()
    else teile.push(teil)
  }
  return teile.join('/').toLowerCase()
}

function paketAus(roh: unknown): InteraktivPaket | null {
  if (!roh || typeof roh !== 'object') return null
  const p = roh as Record<string, unknown>
  if (typeof p.start !== 'string' || !Array.isArray(p.dateien)) return null
  const start = paketPfad(p.start)
  const dateien: InteraktivPaketDatei[] = []
  for (const eintrag of p.dateien.slice(0, MAX_PAKET_DATEIEN)) {
    if (!eintrag || typeof eintrag !== 'object') continue
    const e = eintrag as Record<string, unknown>
    if (typeof e.pfad !== 'string' || !Number.isInteger(e.id) || (e.id as number) < 0 || (e.id as number) > 0xffff) continue
    const pfad = paketPfad(e.pfad)
    if (!pfad) continue
    dateien.push({
      pfad,
      id: e.id as number,
      typ: typeof e.typ === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(e.typ) ? e.typ : 'application/octet-stream',
    })
  }
  if (!start || !dateien.some((d) => d.pfad === start)) return null
  const basis = typeof p.basis === 'string' ? paketPfad(p.basis) : start.split('/').slice(0, -1).join('/')
  const parameter: Record<string, string> = {}
  if (p.parameter && typeof p.parameter === 'object' && !Array.isArray(p.parameter)) {
    for (const [name, wert] of Object.entries(p.parameter as Record<string, unknown>)) {
      if (typeof wert === 'string' || typeof wert === 'number' || typeof wert === 'boolean') parameter[name] = String(wert)
    }
  }
  return { start, basis: basis ? `${basis}/` : '', parameter, skalieren: p.skalieren === true, dateien }
}

/** Lage einer Paketdatei in der Hülle: Byte-Versatz (bezogen auf den Puffer) und Länge. */
export interface PaketBereich {
  offset: number
  laenge: number
}

/**
 * Sucht die DefineBinaryData-Tags (87) einer unkomprimierten Paket-SWF und liefert je Zeichen-ID
 * den Bereich der Nutzdaten. Die Daten selbst werden nicht kopiert.
 */
export function paketBereiche(bytes: Uint8Array): Map<number, PaketBereich> {
  const bereiche = new Map<number, PaketBereich>()
  if (bytes.length < 13 || bytes[0] !== 0x46 || bytes[1] !== 0x57 || bytes[2] !== 0x53) return bereiche
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 8 + bitsInRect(bytes[8]!) + 4
  while (pos + 2 <= bytes.length) {
    const kopf = view.getUint16(pos, true)
    pos += 2
    const code = kopf >> 6
    let laenge = kopf & 0x3f
    if (laenge === 0x3f) {
      if (pos + 4 > bytes.length) break
      laenge = view.getUint32(pos, true)
      pos += 4
    }
    if (code === 0 || pos + laenge > bytes.length) break
    if (code === SWF_TAG_BINAERDATEN && laenge >= 6) {
      bereiche.set(view.getUint16(pos, true), { offset: bytes.byteOffset + pos + 6, laenge: laenge - 6 })
    }
    pos += laenge
  }
  return bereiche
}

/**
 * Verzeichnis des Pakets für den Player: normalisierter Pfad → Bereich und Inhaltstyp.
 * Einträge ohne passenden DefineBinaryData-Tag entfallen.
 */
export function paketVerzeichnis(
  bytes: Uint8Array,
  paket: InteraktivPaket,
): Record<string, { o: number; l: number; t: string }> {
  const bereiche = paketBereiche(bytes)
  const verzeichnis: Record<string, { o: number; l: number; t: string }> = {}
  for (const datei of paket.dateien) {
    const bereich = bereiche.get(datei.id)
    if (bereich) verzeichnis[datei.pfad] = { o: bereich.offset, l: bereich.laenge, t: datei.typ }
  }
  return verzeichnis
}

/** Höchstzahl der Zusatzknöpfe – mehr passen nicht sinnvoll in die Steuerleiste. */
const MAX_AKTIONEN = 8
const FUNKTIONSNAME = /^[A-Za-z_$][\w$]*$/

function argumentAus(wert: unknown): InteraktivArgument | undefined {
  if (wert === null || typeof wert === 'string' || typeof wert === 'boolean') return wert
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : undefined
}

function textAus(wert: unknown): string | null {
  return typeof wert === 'string' && wert.trim() ? wert.trim() : null
}

function aktionenAus(roh: unknown): InteraktivAktion[] {
  if (!Array.isArray(roh)) return []
  const aktionen: InteraktivAktion[] = []
  for (const eintrag of roh) {
    if (!eintrag || typeof eintrag !== 'object') continue
    const e = eintrag as Record<string, unknown>
    const label = textAus(e.label)
    if (!label || typeof e.fn !== 'string' || !FUNKTIONSNAME.test(e.fn)) continue
    const labelAus = textAus(e.labelAus)
    aktionen.push({
      label,
      fn: e.fn,
      arg: argumentAus(e.arg),
      umschalten: labelAus ? { label: labelAus, arg: argumentAus(e.argAus) } : null,
    })
    if (aktionen.length >= MAX_AKTIONEN) break
  }
  return aktionen
}

/** Erklärtext zum Haltepunkt am angegebenen Frame (oder null). */
export function erklaerungFuerFrame(
  meta: InteraktivMetadaten | null,
  frame: number,
): InteraktivErklaerung | null {
  if (!meta) return null
  const index = meta.stopFrames.indexOf(frame)
  return index >= 0 ? (meta.erklaerungen[index] ?? null) : null
}

function bitsInRect(first: number): number {
  const nbits = first >> 3
  return Math.ceil((5 + 4 * nbits) / 8)
}

export interface SwfKopf {
  version: number
  /** Bühnengröße in Pixeln (Header-RECT, Twips / 20). */
  breite: number
  hoehe: number
  bilderProSekunde: number
  bilder: number
}

/** Liest Version und Bühnengröße aus dem Header einer unkomprimierten SWF-Datei. */
export function parseSwfKopf(bytes: Uint8Array): SwfKopf | null {
  if (bytes.length < 13 || bytes[0] !== 0x46 || bytes[1] !== 0x57 || bytes[2] !== 0x53) return null
  const nbits = bytes[8]! >> 3
  let bitPos = 5
  const lies = (): number => {
    let wert = 0
    for (let i = 0; i < nbits; i++, bitPos++) {
      wert = (wert << 1) | ((bytes[8 + (bitPos >> 3)]! >> (7 - (bitPos & 7))) & 1)
    }
    return nbits > 0 && wert & (1 << (nbits - 1)) ? wert - 2 ** nbits : wert
  }
  const xmin = lies()
  const xmax = lies()
  const ymin = lies()
  const ymax = lies()
  const pos = 8 + bitsInRect(bytes[8]!)
  if (pos + 4 > bytes.length) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const breite = (xmax - xmin) / 20
  const hoehe = (ymax - ymin) / 20
  if (!(breite > 0) || !(hoehe > 0)) return null
  return {
    version: bytes[3]!,
    breite,
    hoehe,
    bilderProSekunde: view.getUint16(pos, true) / 256,
    bilder: view.getUint16(pos + 2, true),
  }
}

/**
 * Liest die SARU-Metadaten (Tag 77, JSON) aus einer unkomprimierten SWF-Datei.
 * Gibt null zurück, wenn die Datei komprimiert ist, der Tag fehlt oder das JSON ungültig ist.
 */
export function parseSwfMetadaten(bytes: Uint8Array): InteraktivMetadaten | null {
  if (bytes.length < 13) return null
  // „FWS“ = unkomprimiert; „CWS“/„ZWS“ wären komprimiert und werden nicht ausgewertet.
  if (bytes[0] !== 0x46 || bytes[1] !== 0x57 || bytes[2] !== 0x53) return null

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 8 + bitsInRect(bytes[8]!) + 4 // Header, RECT, Framerate (2) + Framecount (2)

  while (pos + 2 <= bytes.length) {
    const kopf = view.getUint16(pos, true)
    pos += 2
    const code = kopf >> 6
    let laenge = kopf & 0x3f
    if (laenge === 0x3f) {
      if (pos + 4 > bytes.length) return null
      laenge = view.getUint32(pos, true)
      pos += 4
    }
    if (pos + laenge > bytes.length) return null
    if (code === 0) return null // End-Tag
    if (code === SWF_TAG_METADATA) {
      return metadatenAusText(new TextDecoder('utf-8').decode(bytes.subarray(pos, pos + laenge)))
    }
    pos += laenge
  }
  return null
}

function metadatenAusText(roh: string): InteraktivMetadaten | null {
  let json: unknown
  try {
    json = JSON.parse(roh.replace(/\0+$/, '').trim())
  } catch {
    return null
  }
  if (!json || typeof json !== 'object') return null
  const daten = json as Record<string, unknown>
  if (daten.saru !== 1) return null

  // Zuordnung über den ursprünglichen Index, bevor ungültige Frames entfallen.
  const frames = Array.isArray(daten.stopFrames) ? daten.stopFrames : []
  const stopFrames: number[] = []
  const erklaerungen: (InteraktivErklaerung | null)[] = []
  frames.forEach((frame, i) => {
    if (!Number.isInteger(frame) || (frame as number) < 1) return
    stopFrames.push(frame as number)
    const e = Array.isArray(daten.explanations) ? daten.explanations[i] : null
    if (!e || typeof e !== 'object') return void erklaerungen.push(null)
    const { title, text } = e as Record<string, unknown>
    if (typeof title !== 'string' && typeof text !== 'string') return void erklaerungen.push(null)
    erklaerungen.push({ title: typeof title === 'string' ? title : '', text: typeof text === 'string' ? text : '' })
  })
  return {
    title: typeof daten.title === 'string' && daten.title.trim() ? daten.title.trim() : null,
    stopFrames,
    erklaerungen,
    aktionen: aktionenAus(daten.aktionen),
    schieber: daten.schieber === true,
    totalFrames: Number.isInteger(daten.totalFrames) && (daten.totalFrames as number) > 0
      ? (daten.totalFrames as number)
      : null,
    paket: paketAus(daten.paket),
  }
}
