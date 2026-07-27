import { pgEnum } from 'drizzle-orm/pg-core'

export const userRoleEnum = pgEnum('user_role', ['admin', 'lehrkraft', 'leser'])

export const schoolFormEnum = pgEnum('school_form', [
  'grundschule',
  'hauptschule',
  'realschule',
  'gesamtschule',
  'gymnasium',
  'oberstufe',
  'berufsschule',
  'foerderschule',
  'sonstige',
])

/** Materialart – bewusst breit gefasst, deckt die im Lastenheft genannten Typen ab. */
export const materialTypeEnum = pgEnum('material_type', [
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
  'moodle_kurs',
  'h5p',
  'sonstiges',
])

/** Woher stammt der Datensatz – wichtig für die Kennzeichnung von KI-Inhalten. */
export const originEnum = pgEnum('origin', ['manuell', 'ki', 'import'])

export const variantKindEnum = pgEnum('variant_kind', [
  'standard',
  'differenzierung',
  'jahrgang',
  'sprache',
  'sonstige',
])

export const differentiationLevelEnum = pgEnum('differentiation_level', [
  'grundlegend',
  'mittel',
  'erweitert',
])

export const assetKindEnum = pgEnum('asset_kind', ['datei', 'link'])

export const assetRoleEnum = pgEnum('asset_role', ['haupt', 'anhang'])

export const extractionStatusEnum = pgEnum('extraction_status', [
  'ausstehend',
  'laeuft',
  'erfolgreich',
  'fehlgeschlagen',
  'nicht_unterstuetzt',
])

export const materialRelationTypeEnum = pgEnum('material_relation_type', [
  'musterloesung',
  'loesung',
  'zusatzmaterial',
  'differenzierung',
  'gehoert_zu',
  'nachfolger',
  'quelle',
])

export const lessonStatusEnum = pgEnum('lesson_status', [
  'entwurf',
  'geplant',
  'durchgefuehrt',
  'ueberarbeitet',
  'ausgefallen',
])

export const seriesStatusEnum = pgEnum('series_status', [
  'planung',
  'aktiv',
  'abgeschlossen',
  'archiviert',
])

export const socialFormEnum = pgEnum('social_form', [
  'plenum',
  'einzelarbeit',
  'partnerarbeit',
  'gruppenarbeit',
  'stationenarbeit',
  'projektarbeit',
  'sonstige',
])

/** In welchem Kontext wird ein Material in einer Stunde eingesetzt? */
export const materialUsageEnum = pgEnum('material_usage', [
  'unterricht',
  'hausaufgabe',
  'differenzierung',
  'lehrkraft',
  'leistungsnachweis',
])

export const searchEntityTypeEnum = pgEnum('search_entity_type', [
  'material',
  'unterrichtsstunde',
  'reihe',
])

export const importStatusEnum = pgEnum('import_status', [
  'analysiert',
  'vorschau',
  'laeuft',
  'importiert',
  'teilweise_importiert',
  'fehlgeschlagen',
  'rueckgaengig',
])

export const importItemActionEnum = pgEnum('import_item_action', [
  'erstellt',
  'verknuepft',
  'uebersprungen',
  'fehlgeschlagen',
])

export const importLogLevelEnum = pgEnum('import_log_level', ['info', 'warnung', 'fehler'])

export const aiProviderEnum = pgEnum('ai_provider', ['openai', 'ollama', 'openrouter'])

export const aiJobKindEnum = pgEnum('ai_job_kind', [
  'musterloesung',
  'zusammenfassung',
  'verschlagwortung',
  'embedding',
])

export const aiJobStatusEnum = pgEnum('ai_job_status', [
  'wartend',
  'laeuft',
  'erfolgreich',
  'fehlgeschlagen',
])
