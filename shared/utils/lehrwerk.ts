import type { MaterialType } from '../types/domain'

export interface LehrwerkGruppe {
  id: string
  label: string
  icon: string
  types: MaterialType[]
  /** Zusätzlich zum Typ: Titel kann das Material in diese Gruppe holen. */
  titleMatch?: RegExp
}

export type LehrwerkGruppierbar = {
  materialType: string
  title?: string | null
}

/**
 * Feste Reihenfolge für die Lehrwerk-Ansicht.
 * Ein Material darf in mehreren Gruppen stehen (Typ und/oder Titel).
 * Was nirgends passt, landet in „Weiteres“.
 * Serviceband bleibt bewusst ganz oben.
 */
export const LEHRWERK_GRUPPEN: LehrwerkGruppe[] = [
  {
    id: 'serviceband',
    label: 'Serviceband',
    icon: 'chalkboard-user',
    types: ['serviceband'],
    titleMatch: /serviceband|lehrerband|lehrerhandbuch|lehrerhandreichung|begleitband|kommentarband/i,
  },
  {
    id: 'loesungen',
    label: 'Lösungen',
    icon: 'book-bookmark',
    types: ['loesungsbuch', 'musterloesung', 'loesung'],
    titleMatch: /l[oö]sungsheft|l[oö]sungsbuch|musterl[oö]sung/i,
  },
  {
    id: 'versuche',
    label: 'Versuche',
    icon: 'flask',
    types: ['zusatzmaterial'],
    titleMatch: /\bversuche?\b/i,
  },
  {
    id: 'seiten',
    label: 'Lehrbuchseiten',
    icon: 'book-open',
    types: ['lehrbuchseite'],
  },
  {
    id: 'kopiervorlagen',
    label: 'Kopiervorlagen & Aufgaben',
    icon: 'file-lines',
    types: ['arbeitsblatt', 'aufgabe', 'differenzierung'],
  },
  {
    id: 'pruefung',
    label: 'Leistungsnachweise',
    icon: 'file-pen',
    types: ['klausur', 'lernkontrolle'],
  },
  {
    id: 'labor',
    label: 'Sicherheit',
    icon: 'triangle-exclamation',
    types: ['gefaehrdungsbeurteilung', 'unterrichtsentwurf'],
  },
  {
    id: 'medien',
    label: 'Abbildungen & Medien',
    icon: 'image',
    types: ['bild', 'video', 'praesentation', 'h5p'],
  },
  {
    id: 'kurse',
    label: 'Digitale Kurse',
    icon: 'graduation-cap',
    types: ['moodle_kurs'],
  },
  {
    id: 'weiteres',
    label: 'Weiteres',
    icon: 'shapes',
    types: [],
  },
]

const kerngruppen = LEHRWERK_GRUPPEN.filter((gruppe) => gruppe.id !== 'weiteres')
const weiteresGruppe = LEHRWERK_GRUPPEN.find((gruppe) => gruppe.id === 'weiteres')!

export function gehoertZuLehrwerkGruppe(
  item: LehrwerkGruppierbar,
  gruppe: LehrwerkGruppe,
): boolean {
  if (gruppe.id === 'weiteres') return false
  if (gruppe.types.includes(item.materialType as MaterialType)) return true
  const titel = item.title?.trim() ?? ''
  return Boolean(titel && gruppe.titleMatch?.test(titel))
}

export function gruppiereLehrwerkInhalt<T extends LehrwerkGruppierbar>(
  items: T[],
): Array<LehrwerkGruppe & { eintraege: T[] }> {
  const gruppen = kerngruppen.map((gruppe) => ({
    ...gruppe,
    eintraege: items.filter((item) => gehoertZuLehrwerkGruppe(item, gruppe)),
  }))

  const weiteres = items.filter(
    (item) => !kerngruppen.some((gruppe) => gehoertZuLehrwerkGruppe(item, gruppe)),
  )
  if (weiteres.length) {
    gruppen.push({ ...weiteresGruppe, eintraege: weiteres })
  }

  return gruppen.filter((gruppe) => gruppe.eintraege.length > 0)
}
