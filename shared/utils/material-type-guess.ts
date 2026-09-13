import type { MaterialType } from '../types/domain'

function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

const BOOK_TYPES = new Set<MaterialType>(['lehrwerk', 'serviceband', 'loesungsbuch'])

export function isBookLikeMaterialType(type: MaterialType | null | undefined): boolean {
  return Boolean(type && BOOK_TYPES.has(type))
}

/** Grobe Einordnung anhand von Dateiname und optionalem Relativpfad. */
export function guessMaterialType(
  fileName: string,
  fallback: MaterialType = 'arbeitsblatt',
): MaterialType {
  const raw = fileName.replace(/\\/g, '/')
  const name = fold(raw)
  const base = name.split('/').pop() ?? name
  const folder = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : ''

  if (
    /(serviceband|lehrerband|lehrerhandbuch|lehrerhandreichung|handreichung|begleitband|kommentarband)/.test(
      name,
    )
  ) {
    return 'serviceband'
  }
  if (/(loesungsheft|loesungsbuch|loesungen[-_ ]zum)/.test(name)) return 'loesungsbuch'
  if (/(l(o|oe)sung|-lsg|_lsg)/.test(base)) return 'musterloesung'
  if (/(_gfb_|gefaehrdung|gefahrdung)/.test(name)) return 'gefaehrdungsbeurteilung'
  if (/(klausur|klassenarbeit|_ka_)/.test(base) || /klausur/.test(folder)) return 'klausur'
  if (/(abbsb|abbsvb|abbildung)/.test(name)) return 'bild'
  if (
    /(^versuch_|\/versuche?\/)/.test(name) ||
    /(^|\/)versuche?$/.test(folder.split('/').pop() ?? '')
  ) {
    return 'zusatzmaterial'
  }
  if (/(lernkontrolle|test|quiz)/.test(base)) return 'lernkontrolle'
  if (
    /(steckbrief|vorlage|_ab_|kopiervorlage|^ab[-_ ]|arbeitsblatt)/.test(base) ||
    /kopiervorlage/.test(folder)
  ) {
    return 'arbeitsblatt'
  }
  if (/\.(png|jpe?g|gif|webp|avif)$/.test(base)) return 'bild'
  if (/\.(mp4|webm|mov)$/.test(base)) return 'video'
  if (/(praesentation|prasentation|folien)/.test(base) || /\.(pptx?|odp)$/.test(base)) {
    return 'praesentation'
  }
  if (/(lehrwerk|schulbuch|schuelerbuch|schulerbuch)/.test(name)) return 'lehrwerk'
  if (/(elternbrief|brief|einverst(a|ae)ndnis)/.test(base)) return 'sonstiges'
  return fallback
}

/**
 * Korrigiert „Arbeitsblatt“, wenn Dateiname, Text oder Seitenumfang
 * eindeutig auf ein Verlagsbuch deuten.
 */
export function refineMaterialTypeForDocument(options: {
  fileName: string
  current: MaterialType
  pageCount?: number | null
  excerpt?: string | null
  defaultMaterialType?: MaterialType | null
}): MaterialType {
  const forced = options.defaultMaterialType
  if (forced === 'lehrwerk' || forced === 'serviceband' || forced === 'loesungsbuch') {
    return forced
  }

  const fromName = guessMaterialType(options.fileName, options.current)
  if (isBookLikeMaterialType(fromName)) return fromName

  const hay = fold(`${options.fileName}\n${options.excerpt ?? ''}`)
  if (/(serviceband|lehrerband|lehrerhandbuch|lehrerhandreichung|begleitband)/.test(hay)) {
    return 'serviceband'
  }
  if (/(loesungsheft|loesungsbuch)/.test(hay)) return 'loesungsbuch'
  if (
    /(schuelerbuch|schulerbuch|schulbuch|lehrwerk)/.test(hay)
    && !/(serviceband|lehrerband|loesungsheft|loesungsbuch)/.test(hay)
  ) {
    return 'lehrwerk'
  }

  const name = fold(options.fileName)
  const siehtNachArbeitsblattAus =
    /(^ab[-_ ]|_ab_|arbeitsblatt|kopiervorlage|steckbrief)/.test(name.split('/').pop() ?? name)
  if (
    options.current === 'arbeitsblatt'
    && !siehtNachArbeitsblattAus
    && options.pageCount
    && options.pageCount >= 40
  ) {
    return 'serviceband'
  }

  return options.current
}
