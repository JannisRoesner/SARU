/** Klassen 1–10 (numerisch). */
export type NumericGradeLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

/** Hessische Oberstufe: E-Phase (E1, E2) und Qualifikationsphase (Q1–Q4). */
export type OberstufeGradeLevel = 'E1' | 'E2' | 'Q1' | 'Q2' | 'Q3' | 'Q4'

/** Veraltete numerische Oberstufen-Codes – nur noch lesen/anzeigen. */
export type LegacyGradeLevel = '11' | '12' | '13'

export type GradeLevel = NumericGradeLevel | OberstufeGradeLevel | LegacyGradeLevel

export const oberstufeStufen = ['E1', 'E2', 'Q1', 'Q2', 'Q3', 'Q4'] as const satisfies readonly OberstufeGradeLevel[]

export const legacyOberstufeStufen = ['11', '12', '13'] as const satisfies readonly LegacyGradeLevel[]

export const jahrgangsstufenGruppen = [
  { id: 'grundschule', label: 'Grundschule', stufen: [1, 2, 3, 4] as const },
  { id: 'sek1', label: 'Sekundarstufe I', stufen: [5, 6, 7, 8, 9, 10] as const },
  {
    id: 'sek2',
    label: 'Sekundarstufe II',
    stufen: oberstufeStufen,
  },
] as const

export type JahrgangsstufenGruppe = (typeof jahrgangsstufenGruppen)[number]

/** Alle aktuell wählbaren Jahrgangsstufen (ohne Legacy). */
export const alleJahrgangsstufen: GradeLevel[] = [
  ...jahrgangsstufenGruppen.flatMap((g) => [...g.stufen]),
]

const OBERSTUFE_SET = new Set<string>(oberstufeStufen)
const LEGACY_SET = new Set<string>(legacyOberstufeStufen)

/** Sortierreihenfolge für Anzeige und Chips. */
const SORT_ORDER = new Map<string, number>([
  ...([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const).map((n, i) => [String(n), i] as const),
  ['E1', 10],
  ['E2', 11],
  ['Q1', 12],
  ['Q2', 13],
  ['Q3', 14],
  ['Q4', 15],
  ['11', 16],
  ['12', 17],
  ['13', 18],
])

export function gradeLevelSortKey(stufe: GradeLevel): number {
  return SORT_ORDER.get(String(stufe)) ?? 99
}

export function sortGradeLevels(stufen: GradeLevel[]): GradeLevel[] {
  return [...stufen].sort((a, b) => gradeLevelSortKey(a) - gradeLevelSortKey(b))
}

export function isLegacyGradeLevel(stufe: GradeLevel): stufe is LegacyGradeLevel {
  return LEGACY_SET.has(String(stufe))
}

export function isOberstufeGradeLevel(stufe: GradeLevel): stufe is OberstufeGradeLevel {
  return OBERSTUFE_SET.has(String(stufe))
}

/** Speicherformat in der Datenbank (text-Spalte). */
export function gradeLevelToStorage(stufe: GradeLevel): string {
  return String(stufe)
}

/** Liest einen DB-/API-Wert als Jahrgangsstufe; unbekannte Werte → null. */
export function gradeLevelFromStorage(value: unknown): GradeLevel | null {
  if (value == null || value === '') return null

  if (typeof value === 'number' && Number.isInteger(value)) {
    if (value >= 1 && value <= 10) return value as NumericGradeLevel
    if (value >= 11 && value <= 13) return String(value) as LegacyGradeLevel
    return null
  }

  const s = String(value).trim().toUpperCase()
  if (/^[1-9]|10$/.test(s) && Number(s) >= 1 && Number(s) <= 10) {
    return Number(s) as NumericGradeLevel
  }
  if (OBERSTUFE_SET.has(s)) return s as OberstufeGradeLevel
  if (LEGACY_SET.has(s)) return s as LegacyGradeLevel
  return null
}

/** Normalisiert Formular-/Import-Eingaben zu einer gültigen Jahrgangsstufe. */
export function normalizeGradeLevel(value: unknown): GradeLevel | null {
  return gradeLevelFromStorage(value)
}

export function isValidGradeLevel(value: unknown): value is GradeLevel {
  return normalizeGradeLevel(value) !== null
}

export function normalizeGradeLevels(values: unknown[] | null | undefined): GradeLevel[] {
  if (!values?.length) return []
  const unique = new Set<GradeLevel>()
  for (const v of values) {
    const parsed = normalizeGradeLevel(v)
    if (parsed) unique.add(parsed)
  }
  return sortGradeLevels([...unique])
}

export function jahrgangsstufeLabel(stufe: GradeLevel): string {
  if (isLegacyGradeLevel(stufe)) {
    return `${stufe}. Klasse (alt)`
  }
  if (isOberstufeGradeLevel(stufe)) {
    return stufe
  }
  return `${stufe}. Klasse`
}

/** Kurzform für Chips und Badges. */
export function jahrgangsstufeKurz(stufe: GradeLevel): string {
  if (isLegacyGradeLevel(stufe)) return `${stufe} (alt)`
  return String(stufe)
}

/** Jahrgangsstufen kompakt: [5,6,7,'E1'] → „5–7, E1“ */
export function formatJahrgaenge(stufen: GradeLevel[] | null | undefined): string {
  if (!stufen?.length) return '–'

  const sortiert = sortGradeLevels([...new Set(stufen)])
  const gruppen: string[] = []
  let i = 0

  while (i < sortiert.length) {
    const start = sortiert[i]!
    if (typeof start === 'number') {
      let end: number = start
      let j = i + 1
      while (j < sortiert.length && typeof sortiert[j] === 'number' && (sortiert[j] as number) === end + 1) {
        end = sortiert[j] as number
        j++
      }
      gruppen.push(start === end ? `${start}` : `${start}–${end}`)
      i = j
      continue
    }
    gruppen.push(jahrgangsstufeKurz(start))
    i++
  }

  return gruppen.join(', ')
}

/** Optionen für Einzelauswahl (z. B. Import-Zuordnung). */
export function jahrgangsstufenOptionen(): { value: GradeLevel; label: string }[] {
  return alleJahrgangsstufen.map((stufe) => ({
    value: stufe,
    label: jahrgangsstufeLabel(stufe),
  }))
}
