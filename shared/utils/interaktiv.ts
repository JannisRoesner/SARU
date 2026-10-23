import type { MaterialType } from '../types/domain'

/** Dateiendungen interaktiver Inhalte. Später erweiterbar (z. B. HTML-Pakete). */
export const INTERAKTIV_ERWEITERUNGEN = ['swf'] as const
export type InteraktivFormat = (typeof INTERAKTIV_ERWEITERUNGEN)[number]

export function interaktivFormat(fileName: string | null | undefined): InteraktivFormat | null {
  const ext = (fileName ?? '').toLowerCase().split('.').pop() ?? ''
  return (INTERAKTIV_ERWEITERUNGEN as readonly string[]).includes(ext) ? (ext as InteraktivFormat) : null
}

export function istInteraktivDatei(fileName: string | null | undefined): boolean {
  return interaktivFormat(fileName) !== null
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

export interface InteraktivMetadaten {
  title: string | null
  /** Frames, an denen die Animation auf „Weiter“ wartet. */
  stopFrames: number[]
  /** `erklaerungen[i]` gehört zu `stopFrames[i]`. */
  erklaerungen: (InteraktivErklaerung | null)[]
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

  const stopFrames = Array.isArray(daten.stopFrames)
    ? daten.stopFrames.filter((f): f is number => Number.isInteger(f) && (f as number) >= 1)
    : []
  const erklaerungen = stopFrames.map((_, i) => {
    const e = Array.isArray(daten.explanations) ? daten.explanations[i] : null
    if (!e || typeof e !== 'object') return null
    const { title, text } = e as Record<string, unknown>
    if (typeof title !== 'string' && typeof text !== 'string') return null
    return { title: typeof title === 'string' ? title : '', text: typeof text === 'string' ? text : '' }
  })
  return {
    title: typeof daten.title === 'string' && daten.title.trim() ? daten.title.trim() : null,
    stopFrames,
    erklaerungen,
  }
}
