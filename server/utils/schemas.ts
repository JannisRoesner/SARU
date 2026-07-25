import { z } from 'zod'
import {
  AI_PROVIDERS,
  DIFFERENTIATION_LEVELS,
  LESSON_STATUSES,
  MATERIAL_RELATION_TYPES,
  MATERIAL_TYPES,
  MATERIAL_USAGES,
  SCHOOL_FORMS,
  SEARCH_ENTITY_TYPES,
  SERIES_STATUSES,
  SOCIAL_FORMS,
  VARIANT_KINDS,
} from '#shared/types/domain'
import { booleanish, csvArray, paginationSchema, uuidSchema } from './validation'

/** Leerstring aus Formularfeldern soll `null` bedeuten, nicht "leerer Text". */
const nullableText = (max: number) =>
  z
    .string()
    .max(max, `Höchstens ${max} Zeichen erlaubt.`)
    .nullish()
    .transform((v) => (v == null || v.trim() === '' ? null : v))

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Bitte ein Datum im Format JJJJ-MM-TT angeben.')

const objectives = z.array(z.string().max(500)).max(50).optional()
const nameList = z.array(z.string().min(1).max(120)).max(60).optional()
const idList = z.array(uuidSchema).max(200).optional()

const taxonomyFields = {
  subjectIds: idList,
  topicIds: idList,
  competencyIds: idList,
  learningGroupIds: idList,
  gradeLevels: z.array(z.coerce.number().int().min(1).max(13)).max(13).optional(),
  tagNames: nameList,
  competencyNames: nameList,
}

// ---------------------------------------------------------------- Materialien

export const materialCreateSchema = z.object({
  title: z.string().min(1, 'Bitte einen Titel angeben.').max(300),
  description: nullableText(5000),
  content: nullableText(200_000),
  materialType: z.enum(MATERIAL_TYPES).default('arbeitsblatt'),
  schoolForm: z.enum(SCHOOL_FORMS).nullish(),
  source: nullableText(2000),
  author: nullableText(300),
  pages: nullableText(200),
  notes: nullableText(50_000),
  learningObjectives: objectives,
  rating: z.coerce.number().int().min(0).max(5).nullish(),
  isFavorite: z.boolean().optional(),
  ...taxonomyFields,
})

export const materialUpdateSchema = materialCreateSchema.partial()

export const materialListSchema = paginationSchema.extend({
  q: z.string().max(300).optional(),
  sort: z
    .enum(['relevanz', 'datum_neu', 'datum_alt', 'titel', 'zuletzt_verwendet', 'bewertung', 'verwendung'])
    .default('datum_neu'),
  subjectIds: csvArray(uuidSchema),
  topicIds: csvArray(uuidSchema),
  tagIds: csvArray(uuidSchema),
  competencyIds: csvArray(uuidSchema),
  learningGroupIds: csvArray(uuidSchema),
  gradeLevels: csvArray(z.coerce.number().int().min(1).max(13)),
  materialTypes: csvArray(z.enum(MATERIAL_TYPES)),
  schoolForms: csvArray(z.enum(SCHOOL_FORMS)),
  fileTypes: csvArray(z.string().max(10)),
  origin: csvArray(z.enum(['manuell', 'ki', 'import'])),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  onlyFavorites: booleanish,
  includeArchived: booleanish,
  missingSolution: booleanish,
})

export const variantCreateSchema = z.object({
  label: z.string().min(1, 'Bitte eine Bezeichnung angeben.').max(200),
  variantKind: z.enum(VARIANT_KINDS).default('standard'),
  differentiationLevel: z.enum(DIFFERENTIATION_LEVELS).nullish(),
  schoolYear: nullableText(20),
  version: z.string().max(40).optional(),
  notes: nullableText(5000),
})

export const variantUpdateSchema = variantCreateSchema.partial()

export const linkAssetSchema = z.object({
  url: z
    .string()
    .url('Bitte eine gültige Adresse angeben.')
    .max(2000)
    .refine((u) => /^https?:\/\//i.test(u), 'Nur http- und https-Adressen sind erlaubt.'),
  title: nullableText(300),
  role: z.enum(['haupt', 'anhang']).default('anhang'),
})

export const relationSchema = z.object({
  targetId: uuidSchema,
  relationType: z.enum(MATERIAL_RELATION_TYPES),
  note: nullableText(500),
})

export const materialRefSchema = z.object({
  materialId: uuidSchema,
  variantId: uuidSchema.nullish(),
  note: nullableText(500),
})

export const reorderSchema = z.object({ ids: z.array(uuidSchema).min(1).max(200) })

// ------------------------------------------------------------------- Stunden

export const lessonPhaseSchema = z.object({
  name: z.string().min(1, 'Bitte eine Bezeichnung angeben.').max(200),
  durationMinutes: z.coerce.number().int().min(0).max(600).nullish(),
  content: nullableText(10_000),
  teacherActivity: nullableText(5000),
  studentActivity: nullableText(5000),
  method: nullableText(300),
  socialForm: z.enum(SOCIAL_FORMS).nullish(),
  notes: nullableText(5000),
})

export const lessonCreateSchema = z.object({
  title: z.string().min(1, 'Bitte einen Titel angeben.').max(300),
  date: isoDate.nullish(),
  scheduleNote: nullableText(200),
  periodFrom: z.coerce.number().int().min(0).max(20).nullish(),
  periodTo: z.coerce.number().int().min(0).max(20).nullish(),
  durationMinutes: z.coerce.number().int().min(0).max(600).nullish(),
  subjectId: uuidSchema.nullish(),
  learningGroupId: uuidSchema.nullish(),
  topicId: uuidSchema.nullish(),
  seriesId: uuidSchema.nullish(),
  learningObjectives: objectives,
  methodSummary: nullableText(2000),
  homework: nullableText(5000),
  notes: nullableText(20_000),
  reflection: nullableText(20_000),
  substituteTeacher: nullableText(200),
  status: z.enum(LESSON_STATUSES).default('entwurf'),
  competencyIds: idList,
  competencyNames: nameList,
  tagNames: nameList,
})

export const lessonUpdateSchema = lessonCreateSchema.partial()

export const lessonListSchema = paginationSchema.extend({
  q: z.string().max(300).optional(),
  sort: z
    .enum(['relevanz', 'datum_neu', 'datum_alt', 'titel', 'zuletzt_bearbeitet', 'reihenfolge'])
    .default('datum_neu'),
  subjectIds: csvArray(uuidSchema),
  learningGroupIds: csvArray(uuidSchema),
  topicIds: csvArray(uuidSchema),
  seriesIds: csvArray(uuidSchema),
  tagIds: csvArray(uuidSchema),
  competencyIds: csvArray(uuidSchema),
  statuses: csvArray(z.enum(LESSON_STATUSES)),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  withoutSeries: booleanish,
})

export const lessonMaterialSchema = materialRefSchema.extend({
  usage: z.enum(MATERIAL_USAGES).default('unterricht'),
})

// -------------------------------------------------------------------- Reihen

export const seriesCreateSchema = z.object({
  title: z.string().min(1, 'Bitte einen Titel angeben.').max(300),
  description: nullableText(20_000),
  subjectId: uuidSchema.nullish(),
  learningGroupId: uuidSchema.nullish(),
  topicId: uuidSchema.nullish(),
  startDate: isoDate.nullish(),
  endDate: isoDate.nullish(),
  schoolYear: nullableText(20),
  learningObjectives: objectives,
  notes: nullableText(20_000),
  status: z.enum(SERIES_STATUSES).default('planung'),
  competencyIds: idList,
  competencyNames: nameList,
  tagNames: nameList,
})

export const seriesUpdateSchema = seriesCreateSchema.partial()

export const seriesListSchema = paginationSchema.extend({
  q: z.string().max(300).optional(),
  sort: z
    .enum(['relevanz', 'datum_neu', 'datum_alt', 'titel', 'fortschritt'])
    .default('datum_neu'),
  subjectIds: csvArray(uuidSchema),
  learningGroupIds: csvArray(uuidSchema),
  topicIds: csvArray(uuidSchema),
  tagIds: csvArray(uuidSchema),
  statuses: csvArray(z.enum(SERIES_STATUSES)),
  schoolYears: csvArray(z.string().max(20)),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
})

// --------------------------------------------------------------------- Suche

export const searchSchema = z.object({
  q: z.string().max(300).default(''),
  entityTypes: csvArray(z.enum(['material', 'unterrichtsstunde', 'reihe'])),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export const savedSearchSchema = z.object({
  name: z.string().min(1, 'Bitte einen Namen angeben.').max(200),
  query: z.string().max(300).default(''),
  sort: z.string().max(50).default('relevanz'),
  filters: z
    .object({
      subjectIds: idList,
      topicIds: idList,
      tagIds: idList,
      competencyIds: idList,
      learningGroupIds: idList,
      gradeLevels: z.array(z.coerce.number().int().min(1).max(13)).max(13).optional(),
      materialTypes: z.array(z.enum(MATERIAL_TYPES)).optional(),
      fileTypes: z.array(z.string().max(10)).max(30).optional(),
      /** Bestimmt zugleich, auf welche Ansicht sich die Suche bezieht. */
      entityTypes: z.array(z.enum(SEARCH_ENTITY_TYPES)).optional(),
      schoolForms: z.array(z.enum(SCHOOL_FORMS)).optional(),
      dateFrom: isoDate.optional(),
      dateTo: isoDate.optional(),
      onlyFavorites: z.boolean().optional(),
      includeArchived: z.boolean().optional(),
      origin: z.array(z.enum(['manuell', 'ki', 'import'])).optional(),
    })
    .default({}),
})

// ------------------------------------------------------------------ Taxonomie

export const subjectSchema = z.object({
  name: z.string().min(1, 'Bitte einen Namen angeben.').max(120),
  shortName: nullableText(20),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i, 'Bitte eine Farbe als Hex-Wert angeben.')
    .nullish(),
})

export const learningGroupSchema = z.object({
  name: z.string().min(1, 'Bitte einen Namen angeben.').max(120),
  gradeLevel: z.coerce.number().int().min(1).max(13).nullish(),
  schoolYear: nullableText(20),
  schoolForm: z.enum(SCHOOL_FORMS).nullish(),
  subjectId: uuidSchema.nullish(),
  notes: nullableText(2000),
})

export const topicSchema = z.object({
  name: z.string().min(1, 'Bitte einen Namen angeben.').max(200),
  parentId: uuidSchema.nullish(),
  subjectId: uuidSchema.nullish(),
  description: nullableText(2000),
})

export const tagSchema = z.object({
  name: z.string().min(1, 'Bitte einen Namen angeben.').max(120),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).nullish(),
})

export const competencySchema = z.object({
  name: z.string().min(1, 'Bitte einen Namen angeben.').max(300),
  area: nullableText(200),
  code: nullableText(50),
  subjectId: uuidSchema.nullish(),
  description: nullableText(2000),
})

// ------------------------------------------------------------------- Import

export const importMappingSchema = z.object({
  subjectId: uuidSchema.nullish(),
  subjectName: z.string().max(120).optional(),
  learningGroupId: uuidSchema.nullish(),
  learningGroupName: z.string().max(120).optional(),
  gradeLevel: z.coerce.number().int().min(1).max(13).nullish(),
  schoolYear: z.string().max(20).optional(),
  schoolForm: z.enum(SCHOOL_FORMS).nullish(),
  seriesMode: z.enum(['neu', 'bestehend', 'keine']).default('neu'),
  seriesId: uuidSchema.nullish(),
  seriesTitle: z.string().max(300).optional(),
  defaultLessonStatus: z.enum(LESSON_STATUSES).default('durchgefuehrt'),
  createMaterials: z.boolean().default(true),
  linkDuplicates: z.boolean().default(true),
  records: z
    .record(
      z.string(),
      z.object({
        include: z.boolean().default(true),
        title: z.string().max(300).optional(),
        action: z.enum(['erstellen', 'verknuepfen', 'ueberspringen']).default('erstellen'),
        duplicateOfId: uuidSchema.nullish(),
      }),
    )
    .optional(),
})

// --------------------------------------------------------------- Einstellungen

export const aiSettingsSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(AI_PROVIDERS),
    baseUrl: z.string().max(500),
    /**
     * Ein weggelassenes Feld lässt den gespeicherten Schlüssel unverändert –
     * so muss die Oberfläche ihn nie zurücklesen.
     */
    apiKey: z.string().max(500).optional(),
    chatModel: z.string().max(200),
    visionModel: z.string().max(200),
    useVision: z.boolean(),
    embeddingsEnabled: z.boolean(),
    embeddingModel: z.string().max(200),
    temperature: z.coerce.number().min(0).max(2),
    maxOutputTokens: z.coerce.number().int().min(256).max(32_000),
    timeoutMs: z.coerce.number().int().min(5000).max(600_000),
    refererUrl: z.string().max(300),
    appTitle: z.string().max(120),
  })
  .partial()
  .refine(
    (v) => !v.enabled || Boolean(v.chatModel?.trim()),
    { message: 'Bitte ein Chat-Modell angeben.', path: ['chatModel'] },
  )
  .refine(
    (v) => !v.embeddingsEnabled || Boolean(v.embeddingModel?.trim()),
    { message: 'Bitte ein Embedding-Modell angeben.', path: ['embeddingModel'] },
  )

export const aiTestSchema = aiSettingsSchema

export const uploadSettingsSchema = z
  .object({
    maxBytes: z.coerce
      .number()
      .int()
      .min(1024 * 1024)
      .max(2 * 1024 * 1024 * 1024),
    maxImportBytes: z.coerce
      .number()
      .int()
      .min(1024 * 1024)
      .max(4 * 1024 * 1024 * 1024),
    allowedExtensions: z.array(z.string().max(10)).max(80),
    scanArchives: z.boolean(),
  })
  .partial()

export const privacySettingsSchema = z
  .object({
    auditRetentionDays: z.coerce.number().int().min(0).max(3650),
    aiJobRetentionDays: z.coerce.number().int().min(0).max(3650),
    storeAiPrompts: z.boolean(),
    searchHistoryRetentionDays: z.coerce.number().int().min(0).max(3650),
  })
  .partial()

export const appearanceSettingsSchema = z
  .object({
    defaultTheme: z.enum(['hell', 'dunkel', 'system']),
    defaultPalette: z.string().max(40),
    instanceName: z.string().min(1).max(120),
  })
  .partial()
