/**
 * Die Aufzählungen spiegeln die PostgreSQL-Enums wider und werden als
 * `const`-Tupel gehalten, damit sie sowohl als Typ als auch zur Laufzeit
 * (Zod-Validierung, Auswahllisten in der Oberfläche) nutzbar sind.
 */

export const ROLES = ['admin', 'lehrkraft', 'leser'] as const
export type Role = (typeof ROLES)[number]

export const SCHOOL_FORMS = [
  'grundschule',
  'hauptschule',
  'realschule',
  'gesamtschule',
  'gymnasium',
  'oberstufe',
  'berufsschule',
  'foerderschule',
  'sonstige',
] as const
export type SchoolForm = (typeof SCHOOL_FORMS)[number]

export const MATERIAL_TYPES = [
  'arbeitsblatt',
  'musterloesung',
  'loesung',
  'lehrwerk',
  'lehrbuchseite',
  'loesungsbuch',
  'unterrichtsentwurf',
  'praesentation',
  'bild',
  'video',
  'link',
  'aufgabe',
  'lernkontrolle',
  'klausur',
  'zusatzmaterial',
  'differenzierung',
  'notiz',
  'sonstiges',
] as const
export type MaterialType = (typeof MATERIAL_TYPES)[number]

export const ORIGINS = ['manuell', 'ki', 'import'] as const
export type Origin = (typeof ORIGINS)[number]

export const VARIANT_KINDS = [
  'standard',
  'differenzierung',
  'jahrgang',
  'sprache',
  'sonstige',
] as const
export type VariantKind = (typeof VARIANT_KINDS)[number]

export const DIFFERENTIATION_LEVELS = ['grundlegend', 'mittel', 'erweitert'] as const
export type DifferentiationLevel = (typeof DIFFERENTIATION_LEVELS)[number]

export const ASSET_KINDS = ['datei', 'link'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export const ASSET_ROLES = ['haupt', 'anhang', 'loesung', 'vorschau'] as const
export type AssetRole = (typeof ASSET_ROLES)[number]

export const EXTRACTION_STATUSES = [
  'ausstehend',
  'laeuft',
  'erfolgreich',
  'fehlgeschlagen',
  'nicht_unterstuetzt',
] as const
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number]

export const MATERIAL_RELATION_TYPES = [
  'musterloesung',
  'loesung',
  'zusatzmaterial',
  'differenzierung',
  'gehoert_zu',
  'nachfolger',
  'quelle',
] as const
export type MaterialRelationType = (typeof MATERIAL_RELATION_TYPES)[number]

export const LESSON_STATUSES = [
  'entwurf',
  'geplant',
  'durchgefuehrt',
  'ueberarbeitet',
  'ausgefallen',
] as const
export type LessonStatus = (typeof LESSON_STATUSES)[number]

export const SERIES_STATUSES = ['planung', 'aktiv', 'abgeschlossen', 'archiviert'] as const
export type SeriesStatus = (typeof SERIES_STATUSES)[number]

export const SOCIAL_FORMS = [
  'plenum',
  'einzelarbeit',
  'partnerarbeit',
  'gruppenarbeit',
  'stationenarbeit',
  'projektarbeit',
  'sonstige',
] as const
export type SocialForm = (typeof SOCIAL_FORMS)[number]

export const MATERIAL_USAGES = [
  'unterricht',
  'hausaufgabe',
  'differenzierung',
  'lehrkraft',
  'leistungsnachweis',
] as const
export type MaterialUsage = (typeof MATERIAL_USAGES)[number]

export const SEARCH_ENTITY_TYPES = ['material', 'unterrichtsstunde', 'reihe'] as const
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number]

export const AI_PROVIDERS = ['openai', 'ollama', 'openrouter'] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]

export const IMPORT_STATUSES = [
  'analysiert',
  'vorschau',
  'laeuft',
  'importiert',
  'teilweise_importiert',
  'fehlgeschlagen',
  'rueckgaengig',
] as const
export type ImportStatus = (typeof IMPORT_STATUSES)[number]

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}
