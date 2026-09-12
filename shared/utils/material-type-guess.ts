import type { MaterialType } from '../types/domain'

function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
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
  if (/(elternbrief|brief|einverst(a|ae)ndnis)/.test(base)) return 'sonstiges'
  return fallback
}
