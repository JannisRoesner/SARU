/** Klassen 1–10 (numerisch). */
export type NumericGradeLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

/** Hessische Oberstufe: E-Phase (E1, E2) und Qualifikationsphase (Q1–Q4). */
export type OberstufeGradeLevel = 'E1' | 'E2' | 'Q1' | 'Q2' | 'Q3' | 'Q4'

/** Veraltete numerische Oberstufen-Codes – nur noch lesen/anzeigen. */
export type LegacyGradeLevel = '11' | '12' | '13'

export type GradeLevel = NumericGradeLevel | OberstufeGradeLevel | LegacyGradeLevel

export const oberstufeStufen = ['E1', 'E2', 'Q1', 'Q2', 'Q3', 'Q4'] as const satisfies readonly OberstufeGradeLevel[]

/** Einführungsphase (E-Phase) der hessischen Oberstufe. */
export const ePhaseStufen = ['E1', 'E2'] as const satisfies readonly OberstufeGradeLevel[]

/** Qualifikationsphase (Q-Phase) der hessischen Oberstufe. */
export const qPhaseStufen = ['Q1', 'Q2', 'Q3', 'Q4'] as const satisfies readonly OberstufeGradeLevel[]

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

/**
 * Legacy 11–13 auf die hessischen Halbjahre:
 * 11 → E1/E2, 12 → Q1/Q2, 13 → Q3/Q4.
 */
export function mapLegacyOberstufeToCurrent(stufe: GradeLevel): GradeLevel[] {
  if (stufe === '11') return [...ePhaseStufen]
  if (stufe === '12') return [...qPhaseStufen.slice(0, 2)]
  if (stufe === '13') return [...qPhaseStufen.slice(2)]
  return [stufe]
}

/**
 * Liest Phasenbegriffe, wenn das genaue Halbjahr fehlt.
 * „Einführungsphase“ / „E-Phase“ → E1+E2, „Qualifikationsphase“ / „Q-Phase“ → Q1–Q4.
 */
export function gradeLevelsFromOberstufeHint(text: string): GradeLevel[] {
  const hasE = /einf(?:ue|ü)hrungsphase|\be[\s._-]?phase\b/i.test(text)
  const hasQ = /qualifikationsphase|\bq[\s._-]?phase\b/i.test(text)
  if (hasE && hasQ) return [...ePhaseStufen, ...qPhaseStufen]
  if (hasE) return [...ePhaseStufen]
  if (hasQ) return [...qPhaseStufen]
  return []
}

/**
 * Erkennt Jahrgangsstufen im Dateinamen, ohne Kapitel- oder Jahreszahlen
 * zu verwechseln. Explizite Marker (`Klasse 8`, `E1`) haben Vorrang.
 */
export function guessGradeLevelsFromFileName(fileName: string): GradeLevel[] {
  const stem = fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ')
  const found: GradeLevel[] = []

  const add = (raw: string | undefined) => {
    if (!raw) return
    const cleaned = raw.replace(/^0+(\d{1,2})$/, '$1')
    if (/^(19|20)\d{2}$/.test(cleaned)) return
    const normalized = normalizeGradeLevel(cleaned)
    if (!normalized) return
    for (const stufe of mapLegacyOberstufeToCurrent(normalized)) {
      if (!found.includes(stufe)) found.push(stufe)
    }
  }

  for (const match of stem.matchAll(
    /(?:klasse|kl\.?|jahrgang(?:sstufe)?|jgst\.?|jg\.?)\s*(\d{1,2}|e[12]|q[1-4])/gi,
  )) {
    add(match[1])
  }
  for (const match of stem.matchAll(/(\d{1,2}|e[12]|q[1-4])\.\s*(?:klasse|kl\.?|jgst\.?|jg\.?)/gi)) {
    add(match[1])
  }
  if (found.length) return sortGradeLevels(found)

  for (const match of stem.matchAll(/(?:^|[\s.-])(e[12]|q[1-4])(?=[\s.-]|$)/gi)) {
    add(match[1])
  }
  if (found.length) return sortGradeLevels(found)

  const fromPhase = gradeLevelsFromOberstufeHint(stem)
  if (fromPhase.length) return fromPhase

  for (const match of stem.matchAll(/(?:^|[\s.-])([5-9]|10)(?=[\s.-]|$)/g)) {
    add(match[1])
  }
  return sortGradeLevels(found)
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
