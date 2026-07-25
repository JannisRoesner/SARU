const datumKurz = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
const datumLang = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' })
const datumZeit = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
const relativ = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' })

function alsDatum(wert: string | Date | null | undefined): Date | null {
  if (!wert) return null
  const datum = wert instanceof Date ? wert : new Date(wert)
  return Number.isNaN(datum.getTime()) ? null : datum
}

export function formatDatum(wert: string | Date | null | undefined, fallback = '–'): string {
  const datum = alsDatum(wert)
  return datum ? datumKurz.format(datum) : fallback
}

export function formatDatumLang(wert: string | Date | null | undefined, fallback = '–'): string {
  const datum = alsDatum(wert)
  return datum ? datumLang.format(datum) : fallback
}

export function formatDatumZeit(wert: string | Date | null | undefined, fallback = '–'): string {
  const datum = alsDatum(wert)
  return datum ? datumZeit.format(datum) : fallback
}

/** „vor 3 Tagen“, „gestern“, … – für Listen mit vielen Zeitangaben angenehmer zu lesen. */
export function formatRelativ(wert: string | Date | null | undefined, fallback = '–'): string {
  const datum = alsDatum(wert)
  if (!datum) return fallback

  const sekunden = (datum.getTime() - Date.now()) / 1000
  const stufen: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
    ['year', Number.POSITIVE_INFINITY],
  ]

  let wertInEinheit = sekunden
  for (const [einheit, faktor] of stufen) {
    if (Math.abs(wertInEinheit) < faktor) return relativ.format(Math.round(wertInEinheit), einheit)
    wertInEinheit /= faktor
  }
  return datumKurz.format(datum)
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '–'
  if (bytes < 1024) return `${bytes} B`
  const einheiten = ['KB', 'MB', 'GB']
  let wert = bytes / 1024
  let index = 0
  while (wert >= 1024 && index < einheiten.length - 1) {
    wert /= 1024
    index += 1
  }
  return `${wert.toLocaleString('de-DE', { maximumFractionDigits: wert < 10 ? 1 : 0 })} ${einheiten[index]}`
}

/** „45 Min.“ bzw. „1 Std. 30 Min.“ */
export function formatDauer(minuten: number | null | undefined): string {
  if (!minuten) return '–'
  const stunden = Math.floor(minuten / 60)
  const rest = minuten % 60
  if (!stunden) return `${rest} Min.`
  return rest ? `${stunden} Std. ${rest} Min.` : `${stunden} Std.`
}

/** „3.–4. Stunde“ bzw. „2. Stunde“ */
export function formatSchulstunden(von: number | null, bis: number | null): string | null {
  if (!von) return null
  if (!bis || bis === von) return `${von}. Stunde`
  return `${von}.–${bis}. Stunde`
}

export function formatZahl(wert: number | null | undefined): string {
  return (wert ?? 0).toLocaleString('de-DE')
}

/** @deprecated Import aus `#shared/utils/jahrgangsstufen` bevorzugen. */
export { formatJahrgaenge } from '#shared/utils/jahrgangsstufen'
export type { GradeLevel } from '#shared/utils/jahrgangsstufen'

/** Jahrgangsstufen kompakt – siehe `formatJahrgaenge` in shared/utils/jahrgangsstufen. */
export function formatJahrgaengeLegacy(stufen: number[] | null | undefined): string {
  if (!stufen?.length) return '–'
  const sortiert = [...new Set(stufen)].sort((a, b) => a - b)
  const gruppen: string[] = []
  let start = sortiert[0]!
  let vorher = start

  for (const stufe of sortiert.slice(1)) {
    if (stufe === vorher + 1) {
      vorher = stufe
      continue
    }
    gruppen.push(start === vorher ? `${start}` : `${start}–${vorher}`)
    start = stufe
    vorher = stufe
  }
  gruppen.push(start === vorher ? `${start}` : `${start}–${vorher}`)
  return gruppen.join(', ')
}

export function dateiEndung(dateiname: string | null | undefined): string | null {
  if (!dateiname) return null
  const punkt = dateiname.lastIndexOf('.')
  return punkt > 0 ? dateiname.slice(punkt + 1).toLowerCase() : null
}

const DATEI_ICONS: Record<string, string> = {
  pdf: 'file-pdf',
  doc: 'file-word',
  docx: 'file-word',
  odt: 'file-word',
  xls: 'file-excel',
  xlsx: 'file-excel',
  ods: 'file-excel',
  ppt: 'file-powerpoint',
  pptx: 'file-powerpoint',
  odp: 'file-powerpoint',
  png: 'file-image',
  jpg: 'file-image',
  jpeg: 'file-image',
  gif: 'file-image',
  webp: 'file-image',
  svg: 'file-image',
  mp4: 'file-video',
  webm: 'file-video',
  mp3: 'file-audio',
  zip: 'file-zipper',
  txt: 'file-lines',
  md: 'file-lines',
}

export function dateiIcon(dateiname: string | null | undefined): string {
  return DATEI_ICONS[dateiEndung(dateiname) ?? ''] ?? 'file'
}

/** Kürzt Fließtext auf eine Vorschaulänge, ohne Wörter zu zerschneiden. */
export function kuerzen(text: string | null | undefined, laenge = 160): string {
  if (!text) return ''
  if (text.length <= laenge) return text
  const schnitt = text.slice(0, laenge)
  const luecke = schnitt.lastIndexOf(' ')
  return `${(luecke > laenge * 0.6 ? schnitt.slice(0, luecke) : schnitt).trimEnd()} …`
}

/** Deutscher Zeitraum, z. B. „5. Feb. – 25. Juni 2025“. */
export function formatZeitraum(von: string | null, bis: string | null): string {
  if (!von && !bis) return 'Kein Zeitraum'
  if (von && !bis) return `ab ${formatDatum(von)}`
  if (!von && bis) return `bis ${formatDatum(bis)}`
  return `${formatDatum(von)} – ${formatDatum(bis)}`
}
