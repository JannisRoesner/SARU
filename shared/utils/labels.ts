import type {
  AiProvider,
  DifferentiationLevel,
  ImportStatus,
  LessonStatus,
  MaterialRelationType,
  MaterialType,
  MaterialUsage,
  Origin,
  Role,
  SchoolForm,
  SearchEntityType,
  SeriesStatus,
  SocialForm,
  VariantKind,
} from '../types/domain'

export interface LabelDefinition {
  label: string
  /** FontAwesome-Icon ohne Präfix, z. B. `file-lines`. */
  icon?: string
  /** Semantischer Badge-Ton – Farben kommen aus CSS-Variablen (palette- und modusabhängig). */
  tone?: 'neutral' | 'primary' | 'accent' | 'gruen' | 'gelb' | 'rot' | 'violett' | 'ki'
  description?: string
}

function definitions<T extends string>(map: Record<T, LabelDefinition>) {
  return {
    map,
    label: (key: T | null | undefined, fallback = '–') => (key ? (map[key]?.label ?? key) : fallback),
    icon: (key: T | null | undefined) => (key ? map[key]?.icon : undefined),
    tone: (key: T | null | undefined) => (key ? (map[key]?.tone ?? 'neutral') : 'neutral'),
    options: () =>
      (Object.entries(map) as [T, LabelDefinition][]).map(([value, def]) => ({
        value,
        label: def.label,
        icon: def.icon,
        tone: def.tone,
        description: def.description,
      })),
  }
}

export const materialTypes = definitions<MaterialType>({
  arbeitsblatt: { label: 'Arbeitsblatt', icon: 'file-lines', tone: 'primary' },
  musterloesung: { label: 'Musterlösung', icon: 'circle-check', tone: 'gruen' },
  loesung: { label: 'Lösung', icon: 'key', tone: 'gruen' },
  lehrwerk: { label: 'Lehrwerk', icon: 'book', tone: 'neutral' },
  lehrbuchseite: { label: 'Lehrbuchseite', icon: 'book-open', tone: 'neutral' },
  loesungsbuch: { label: 'Lösungsbuch', icon: 'book-bookmark', tone: 'gruen' },
  unterrichtsentwurf: { label: 'Unterrichtsentwurf', icon: 'clipboard-list', tone: 'accent' },
  praesentation: { label: 'Präsentation', icon: 'display', tone: 'accent' },
  bild: { label: 'Bild', icon: 'image', tone: 'violett' },
  video: { label: 'Video', icon: 'film', tone: 'violett' },
  link: { label: 'Link', icon: 'link', tone: 'neutral' },
  aufgabe: { label: 'Aufgabe', icon: 'list-check', tone: 'primary' },
  lernkontrolle: { label: 'Lernkontrolle', icon: 'clipboard-question', tone: 'gelb' },
  klausur: { label: 'Klausur', icon: 'file-pen', tone: 'rot' },
  zusatzmaterial: { label: 'Zusatzmaterial', icon: 'circle-plus', tone: 'neutral' },
  differenzierung: { label: 'Differenzierungsmaterial', icon: 'code-branch', tone: 'accent' },
  notiz: { label: 'Notiz', icon: 'note-sticky', tone: 'gelb' },
  moodle_kurs: {
    label: 'Moodle-Kurs',
    icon: 'graduation-cap',
    tone: 'primary',
    description: 'Fertiges Kursarchiv (.mbz / .imscc) zum Wiederherstellen im SchulMoodle',
  },
  h5p: {
    label: 'H5P-Inhalt',
    icon: 'puzzle-piece',
    tone: 'accent',
    description: 'Interaktives H5P-Lernpaket (.h5p) zum Einbetten oder Hochladen in Moodle',
  },
  sonstiges: { label: 'Sonstiges', icon: 'shapes', tone: 'neutral' },
})

export const schoolForms = definitions<SchoolForm>({
  grundschule: { label: 'Grundschule' },
  hauptschule: { label: 'Hauptschule' },
  realschule: { label: 'Realschule' },
  gesamtschule: { label: 'Gesamtschule' },
  gymnasium: { label: 'Gymnasium' },
  oberstufe: { label: 'Gymnasiale Oberstufe' },
  berufsschule: { label: 'Berufliche Schule' },
  foerderschule: { label: 'Förderschule' },
  sonstige: { label: 'Sonstige' },
})

export const origins = definitions<Origin>({
  manuell: { label: 'Selbst erstellt', icon: 'user-pen', tone: 'neutral' },
  ki: { label: 'KI-generiert', icon: 'wand-magic-sparkles', tone: 'ki' },
  import: { label: 'Importiert', icon: 'file-import', tone: 'primary' },
})

export const variantKinds = definitions<VariantKind>({
  standard: { label: 'Standardfassung', icon: 'file' },
  differenzierung: { label: 'Differenzierung', icon: 'code-branch' },
  jahrgang: { label: 'Jahresfassung', icon: 'calendar' },
  sprache: { label: 'Sprachfassung', icon: 'language' },
  sonstige: { label: 'Sonstige Fassung', icon: 'shapes' },
})

export const differentiationLevels = definitions<DifferentiationLevel>({
  grundlegend: { label: 'Grundlegend', tone: 'gruen' },
  mittel: { label: 'Mittel', tone: 'gelb' },
  erweitert: { label: 'Erweitert', tone: 'rot' },
})

export const materialRelationTypes = definitions<MaterialRelationType>({
  musterloesung: { label: 'Musterlösung', icon: 'circle-check', tone: 'gruen' },
  loesung: { label: 'Lösung', icon: 'key', tone: 'gruen' },
  zusatzmaterial: { label: 'Zusatzmaterial', icon: 'circle-plus' },
  differenzierung: { label: 'Differenzierung', icon: 'code-branch' },
  gehoert_zu: { label: 'Gehört zu', icon: 'link' },
  nachfolger: { label: 'Folgt auf', icon: 'arrow-right' },
  quelle: { label: 'Quelle', icon: 'quote-left' },
})

export const lessonStatuses = definitions<LessonStatus>({
  entwurf: { label: 'Entwurf', icon: 'pencil', tone: 'neutral' },
  geplant: { label: 'Geplant', icon: 'calendar-check', tone: 'primary' },
  durchgefuehrt: { label: 'Durchgeführt', icon: 'circle-check', tone: 'gruen' },
  ueberarbeitet: { label: 'Überarbeitet', icon: 'rotate', tone: 'accent' },
  ausgefallen: { label: 'Ausgefallen', icon: 'ban', tone: 'rot' },
})

export const seriesStatuses = definitions<SeriesStatus>({
  planung: { label: 'In Planung', icon: 'compass-drafting', tone: 'neutral' },
  aktiv: { label: 'Laufend', icon: 'play', tone: 'primary' },
  abgeschlossen: { label: 'Abgeschlossen', icon: 'flag-checkered', tone: 'gruen' },
  archiviert: { label: 'Archiviert', icon: 'box-archive', tone: 'neutral' },
})

export const socialForms = definitions<SocialForm>({
  plenum: { label: 'Plenum', icon: 'users' },
  einzelarbeit: { label: 'Einzelarbeit', icon: 'user' },
  partnerarbeit: { label: 'Partnerarbeit', icon: 'user-group' },
  gruppenarbeit: { label: 'Gruppenarbeit', icon: 'people-group' },
  stationenarbeit: { label: 'Stationenarbeit', icon: 'map-location-dot' },
  projektarbeit: { label: 'Projektarbeit', icon: 'diagram-project' },
  sonstige: { label: 'Sonstige', icon: 'shapes' },
})

export const materialUsages = definitions<MaterialUsage>({
  unterricht: { label: 'Im Unterricht', icon: 'chalkboard-user' },
  hausaufgabe: { label: 'Hausaufgabe', icon: 'house' },
  differenzierung: { label: 'Differenzierung', icon: 'code-branch' },
  lehrkraft: { label: 'Nur für die Lehrkraft', icon: 'user-shield' },
  leistungsnachweis: { label: 'Leistungsnachweis', icon: 'file-pen' },
})

export const searchEntityTypes = definitions<SearchEntityType>({
  material: { label: 'Material', icon: 'folder-open', tone: 'primary' },
  unterrichtsstunde: { label: 'Unterrichtsstunde', icon: 'chalkboard-user', tone: 'accent' },
  reihe: { label: 'Reihe', icon: 'layer-group', tone: 'violett' },
})

export const roles = definitions<Role>({
  admin: {
    label: 'Administration',
    icon: 'user-shield',
    description: 'Vollzugriff inklusive Benutzerverwaltung und Systemeinstellungen.',
  },
  lehrkraft: {
    label: 'Lehrkraft',
    icon: 'chalkboard-user',
    description: 'Darf Materialien, Stunden und Reihen anlegen und bearbeiten.',
  },
  leser: {
    label: 'Lesezugriff',
    icon: 'eye',
    description: 'Darf Inhalte ansehen und suchen, aber nichts verändern.',
  },
})

export const aiProviders = definitions<AiProvider>({
  openai: { label: 'OpenAI', icon: 'cloud' },
  ollama: { label: 'Ollama (lokal)', icon: 'server' },
  openrouter: { label: 'OpenRouter', icon: 'route' },
})

export const importStatuses = definitions<ImportStatus>({
  analysiert: { label: 'Analysiert', icon: 'magnifying-glass', tone: 'neutral' },
  vorschau: { label: 'Vorschau bereit', icon: 'eye', tone: 'primary' },
  laeuft: { label: 'Läuft', icon: 'spinner', tone: 'primary' },
  importiert: { label: 'Importiert', icon: 'circle-check', tone: 'gruen' },
  teilweise_importiert: { label: 'Teilweise importiert', icon: 'triangle-exclamation', tone: 'gelb' },
  fehlgeschlagen: { label: 'Fehlgeschlagen', icon: 'circle-xmark', tone: 'rot' },
  rueckgaengig: { label: 'Rückgängig gemacht', icon: 'rotate-left', tone: 'neutral' },
})

/** Häufige Unterrichtsmethoden als Vorschlagsliste im Stundeneditor. */
export const methodSuggestions = [
  'Lehrervortrag',
  'Unterrichtsgespräch',
  'Impuls',
  'Brainstorming',
  'Placemat',
  'Think-Pair-Share',
  'Gruppenpuzzle',
  'Stationenlernen',
  'Experiment',
  'Recherche',
  'Rollenspiel',
  'Diskussion',
  'Museumsgang',
  'Lernplakat',
  'Fishbowl',
  'Blitzlicht',
  'Kugellager',
  'Expertenbefragung',
]

/** Übliche Phasenbezeichnungen für den schnellen Aufbau einer Stunde. */
export const phaseSuggestions = [
  'Einstieg',
  'Problematisierung',
  'Erarbeitung',
  'Erarbeitung I',
  'Erarbeitung II',
  'Sicherung',
  'Vertiefung',
  'Übung',
  'Transfer',
  'Reflexion',
  'Hausaufgabe',
  'Abschluss',
]
