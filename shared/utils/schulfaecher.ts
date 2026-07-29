/**
 * Übliche Schulfächer in Hessen (Gymnasium, Realschule, Gesamtschule).
 * Orientierung für KI-Vorschläge – keine Unterrichtsthemen oder Detailgebiete.
 */
export const HESSEN_SCHULFAECHER = [
  'Deutsch',
  'Mathematik',
  'Englisch',
  'Biologie',
  'Chemie',
  'Physik',
  'Informatik',
  'Geschichte',
  'Geographie',
  'Politik und Wirtschaft',
  'Kunst',
  'Musik',
  'Sport',
  'Religion',
  'Evangelische Religion',
  'Katholische Religion',
  'Ethik',
  'Philosophie',
  'Französisch',
  'Spanisch',
  'Latein',
  'Italienisch',
  'Russisch',
  'Chinesisch',
  'Griechisch',
  'Hebräisch',
  'Arbeitslehre',
  'Technik',
  'Wirtschaft',
  'Wirtschaft und Recht',
  'Hauswirtschaft',
  'Ernährung',
  'Pädagogik',
  'Sozialwissenschaften',
  'Darstellendes Spiel',
  'Medienbildung',
  'ISI',
  'NaWi',
] as const

export type HessenSchulfach = (typeof HESSEN_SCHULFAECHER)[number]

/** Aliase und Abkürzungen → kanonischer Fachname. */
const ALIAS_MAP = new Map<string, HessenSchulfach>([
  ['bio', 'Biologie'],
  ['biologie', 'Biologie'],
  ['chem', 'Chemie'],
  ['chemie', 'Chemie'],
  ['physik', 'Physik'],
  ['phys', 'Physik'],
  ['info', 'Informatik'],
  ['informatik', 'Informatik'],
  ['it', 'Informatik'],
  ['computerscience', 'Informatik'],
  ['deutsch', 'Deutsch'],
  ['mathe', 'Mathematik'],
  ['mathematik', 'Mathematik'],
  ['math', 'Mathematik'],
  ['englisch', 'Englisch'],
  ['english', 'Englisch'],
  ['eng', 'Englisch'],
  ['französisch', 'Französisch'],
  ['franzoesisch', 'Französisch'],
  ['fr', 'Französisch'],
  ['spanisch', 'Spanisch'],
  ['es', 'Spanisch'],
  ['latein', 'Latein'],
  ['la', 'Latein'],
  ['italienisch', 'Italienisch'],
  ['russisch', 'Russisch'],
  ['chinesisch', 'Chinesisch'],
  ['griechisch', 'Griechisch'],
  ['hebräisch', 'Hebräisch'],
  ['hebraeisch', 'Hebräisch'],
  ['geschichte', 'Geschichte'],
  ['ge', 'Geschichte'],
  ['geo', 'Geographie'],
  ['geographie', 'Geographie'],
  ['erdkunde', 'Geographie'],
  ['erdk', 'Geographie'],
  ['politik', 'Politik und Wirtschaft'],
  ['politik und wirtschaft', 'Politik und Wirtschaft'],
  ['politik u. wirtschaft', 'Politik und Wirtschaft'],
  ['politik und wirtschaft (pw)', 'Politik und Wirtschaft'],
  ['pw', 'Politik und Wirtschaft'],
  ['p u w', 'Politik und Wirtschaft'],
  ['sozialkunde', 'Politik und Wirtschaft'],
  ['gemeinschaftskunde', 'Politik und Wirtschaft'],
  ['kunst', 'Kunst'],
  ['ku', 'Kunst'],
  ['musik', 'Musik'],
  ['mu', 'Musik'],
  ['sport', 'Sport'],
  ['sp', 'Sport'],
  ['religion', 'Religion'],
  ['ev. religion', 'Evangelische Religion'],
  ['evangelische religion', 'Evangelische Religion'],
  ['ev-rel', 'Evangelische Religion'],
  ['kath. religion', 'Katholische Religion'],
  ['katholische religion', 'Katholische Religion'],
  ['kath-rel', 'Katholische Religion'],
  ['ethik', 'Ethik'],
  ['philosophie', 'Philosophie'],
  ['arbeitslehre', 'Arbeitslehre'],
  ['technik', 'Technik'],
  ['wirtschaft', 'Wirtschaft'],
  ['wirtschaft und recht', 'Wirtschaft und Recht'],
  ['wirtschaft u. recht', 'Wirtschaft und Recht'],
  ['wur', 'Wirtschaft und Recht'],
  ['hauswirtschaft', 'Hauswirtschaft'],
  ['ernährung', 'Ernährung'],
  ['ernaehrung', 'Ernährung'],
  ['pädagogik', 'Pädagogik'],
  ['paedagogik', 'Pädagogik'],
  ['sozialwissenschaften', 'Sozialwissenschaften'],
  ['darstellendes spiel', 'Darstellendes Spiel'],
  ['theater', 'Darstellendes Spiel'],
  ['medienbildung', 'Medienbildung'],
])

const CANONICAL_SET = new Set<string>(HESSEN_SCHULFAECHER.map((f) => f.toLowerCase()))

/** Normalisiert einen Freitext auf einen kanonischen hessischen Fachnamen oder `null`. */
export function normalizeSchulfach(value: string): HessenSchulfach | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const key = trimmed.toLowerCase()
  const alias = ALIAS_MAP.get(key)
  if (alias) return alias

  if (CANONICAL_SET.has(key)) {
    return HESSEN_SCHULFAECHER.find((f) => f.toLowerCase() === key) ?? null
  }

  return null
}

/** Filtert und normalisiert eine Liste von Fachvorschlägen (max. 3, ohne Dubletten). */
export function normalizeSchulfaecher(values: unknown, max = 3): HessenSchulfach[] {
  if (!Array.isArray(values)) return []

  const result: HessenSchulfach[] = []
  const seen = new Set<string>()

  for (const value of values) {
    if (typeof value !== 'string') continue
    const normalized = normalizeSchulfach(value)
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
    if (result.length >= max) break
  }

  return result
}

/** Komma-getrennte Liste für KI-Prompts. */
export function schulfaecherPromptListe(): string {
  return HESSEN_SCHULFAECHER.join(', ')
}
