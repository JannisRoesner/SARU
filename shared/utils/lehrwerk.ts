import type { MaterialType } from '../types/domain'

export interface LehrwerkGruppe {
  id: string
  label: string
  icon: string
  types: MaterialType[]
}

/**
 * Feste Reihenfolge für die Lehrwerk-Ansicht.
 * Typen, die in keiner Gruppe stehen, landen in „Weiteres“.
 */
export const LEHRWERK_GRUPPEN: LehrwerkGruppe[] = [
  {
    id: 'lehrerband',
    label: 'Lehrerband, Serviceband & Lösungen',
    icon: 'book-bookmark',
    types: ['loesungsbuch', 'musterloesung', 'loesung', 'zusatzmaterial'],
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
    label: 'Versuche & Sicherheit',
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

const gruppierteTypen = new Set<string>(LEHRWERK_GRUPPEN.flatMap((gruppe) => gruppe.types))

export function gruppiereLehrwerkInhalt<T extends { materialType: string }>(
  items: T[],
): Array<LehrwerkGruppe & { eintraege: T[] }> {
  return LEHRWERK_GRUPPEN.map((gruppe) => ({
    ...gruppe,
    eintraege:
      gruppe.id === 'weiteres'
        ? items.filter((item) => !gruppierteTypen.has(item.materialType))
        : items.filter((item) => gruppe.types.includes(item.materialType as MaterialType)),
  })).filter((gruppe) => gruppe.eintraege.length > 0)
}
