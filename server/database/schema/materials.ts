import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './auth'
import {
  assetKindEnum,
  assetRoleEnum,
  differentiationLevelEnum,
  extractionStatusEnum,
  materialRelationTypeEnum,
  materialTypeEnum,
  originEnum,
  schoolFormEnum,
  variantKindEnum,
} from './enums'
import { competencies, learningGroups, subjects, tags, topics } from './taxonomy'

/** Persistierte Antwortstruktur einer KI-Musterlösung (Nachbearbeitung / Re-Render). */
export interface StoredSolutionBBox {
  x: number
  y: number
  w?: number
  h?: number
}

export interface StoredSolutionAnswer {
  id: string
  label: string
  answer: string
  page?: number | null
  blankIndex?: number | null
  leftContext?: string | null
  rightContext?: string | null
  bbox?: StoredSolutionBBox | null
  fieldType?: 'luecke' | 'freitext' | null
}

export interface StoredStructuredSolution {
  summary: string
  answers: StoredSolutionAnswer[]
  formFields: Array<{ name: string; value: string }>
  notesForTeacher?: string | null
  uncertainties?: string | null
}

export interface AiMeta {
  provider?: string
  model?: string
  generatedAt?: string
  sourceMaterialId?: string
  promptVersion?: string
  /** Von einer Lehrkraft fachlich geprüft und freigegeben. */
  reviewed?: boolean
  reviewedAt?: string
  reviewedBy?: string
  /** Strategie der dokumentbasierten Musterlösung (docx_inplace, pdf_acroform, …). */
  fillStrategy?: string
  hermesUsed?: boolean
  sourceFileName?: string
  /** Volle strukturierte Lösung inkl. Positionen – für Korrektur und PDF-Neuzeichnung. */
  structuredSolution?: StoredStructuredSolution | null
  /** Varianten-ID der Quelldatei, aus der die Lösung erzeugt wurde. */
  sourceVariantId?: string | null
  /** Asset-ID der Quell-PDF (für visuelle Nachbearbeitung). */
  sourceAssetId?: string | null
  editedAt?: string
  editedBy?: string
}

/**
 * Ein Material ist die fachliche Einheit („Arbeitsblatt Zellatmung“).
 * Die konkreten Dateien hängen an den Varianten, damit Differenzierungs- und
 * Jahresfassungen dasselbe Material bleiben.
 */
export const materials = pgTable(
  'materials',
  {
    id: uuid().primaryKey().defaultRandom(),
    title: text().notNull(),
    description: text(),
    /**
     * Textinhalt für Materialien ohne Datei (Notizen) bzw. kurze Zusammenfassung
     * bei dokumentbasierten KI-Musterlösungen. Wird als Markdown gespeichert und mitindiziert.
     */
    content: text(),
    materialType: materialTypeEnum().notNull().default('arbeitsblatt'),
    schoolForm: schoolFormEnum(),
    /** Herkunft/Quelle, z. B. „Natura 9, Klett“ oder eine URL. */
    source: text(),
    author: text(),
    /** Seitenangaben als Freitext, z. B. „S. 244–245“. */
    pages: text(),
    notes: text(),
    learningObjectives: text().array().notNull().default([]),
    rating: integer(),
    isFavorite: boolean().notNull().default(false),
    isArchived: boolean().notNull().default(false),
    origin: originEnum().notNull().default('manuell'),
    aiMeta: jsonb().$type<AiMeta>(),
    ownerId: uuid().references(() => users.id, { onDelete: 'set null' }),
    lastUsedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('materials_type_idx').on(t.materialType),
    index('materials_owner_idx').on(t.ownerId),
    index('materials_archived_idx').on(t.isArchived),
    index('materials_favorite_idx').on(t.isFavorite),
    index('materials_updated_idx').on(t.updatedAt),
    index('materials_origin_idx').on(t.origin),
  ],
)

/**
 * Differenzierungs- oder Jahresvariante eines Materials.
 * Jedes Material besitzt mindestens eine Variante (`isDefault`).
 */
export const materialVariants = pgTable(
  'material_variants',
  {
    id: uuid().primaryKey().defaultRandom(),
    materialId: uuid()
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    label: text().notNull(),
    variantKind: variantKindEnum().notNull().default('standard'),
    differentiationLevel: differentiationLevelEnum(),
    schoolYear: text(),
    version: text().notNull().default('1'),
    notes: text(),
    isDefault: boolean().notNull().default(false),
    sortOrder: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('material_variants_material_idx').on(t.materialId),
    index('material_variants_sort_idx').on(t.materialId, t.sortOrder),
  ],
)

/** Datei oder externer Link innerhalb einer Variante. */
export const materialAssets = pgTable(
  'material_assets',
  {
    id: uuid().primaryKey().defaultRandom(),
    variantId: uuid()
      .notNull()
      .references(() => materialVariants.id, { onDelete: 'cascade' }),
    kind: assetKindEnum().notNull().default('datei'),
    role: assetRoleEnum().notNull().default('haupt'),
    title: text(),
    /** Ursprünglicher Dateiname, nur zur Anzeige und für den Download. */
    fileName: text(),
    /** Relativer Pfad im Upload-Verzeichnis – nie vom Client bestimmt. */
    storageKey: text(),
    mimeType: text(),
    sizeBytes: bigint({ mode: 'number' }),
    checksum: text(),
    url: text(),
    pageCount: integer(),
    extractedText: text(),
    extractionStatus: extractionStatusEnum().notNull().default('ausstehend'),
    extractionError: text(),
    sortOrder: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('material_assets_variant_idx').on(t.variantId),
    index('material_assets_checksum_idx').on(t.checksum),
    index('material_assets_status_idx').on(t.extractionStatus),
  ],
)

/** Beziehungen zwischen Materialien, insbesondere Material → Musterlösung. */
export const materialRelations = pgTable(
  'material_relations',
  {
    id: uuid().primaryKey().defaultRandom(),
    fromMaterialId: uuid()
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    toMaterialId: uuid()
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    relationType: materialRelationTypeEnum().notNull(),
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('material_relations_uq').on(t.fromMaterialId, t.toMaterialId, t.relationType),
    index('material_relations_from_idx').on(t.fromMaterialId),
    index('material_relations_to_idx').on(t.toMaterialId),
  ],
)

export const materialSubjects = pgTable(
  'material_subjects',
  {
    materialId: uuid()
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    subjectId: uuid()
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.materialId, t.subjectId] }), index('material_subjects_subject_idx').on(t.subjectId)],
)

export const materialTopics = pgTable(
  'material_topics',
  {
    materialId: uuid()
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    topicId: uuid()
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.materialId, t.topicId] }), index('material_topics_topic_idx').on(t.topicId)],
)

export const materialTags = pgTable(
  'material_tags',
  {
    materialId: uuid()
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    tagId: uuid()
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.materialId, t.tagId] }), index('material_tags_tag_idx').on(t.tagId)],
)

export const materialCompetencies = pgTable(
  'material_competencies',
  {
    materialId: uuid()
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    competencyId: uuid()
      .notNull()
      .references(() => competencies.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.materialId, t.competencyId] }),
    index('material_competencies_competency_idx').on(t.competencyId),
  ],
)

export const materialGradeLevels = pgTable(
  'material_grade_levels',
  {
    materialId: uuid()
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    gradeLevel: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.materialId, t.gradeLevel] }),
    index('material_grade_levels_grade_idx').on(t.gradeLevel),
  ],
)

export const materialLearningGroups = pgTable(
  'material_learning_groups',
  {
    materialId: uuid()
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    learningGroupId: uuid()
      .notNull()
      .references(() => learningGroups.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.materialId, t.learningGroupId] }),
    index('material_learning_groups_group_idx').on(t.learningGroupId),
  ],
)

export type Material = typeof materials.$inferSelect
export type NewMaterial = typeof materials.$inferInsert
export type MaterialVariant = typeof materialVariants.$inferSelect
export type MaterialAsset = typeof materialAssets.$inferSelect
export type MaterialRelation = typeof materialRelations.$inferSelect
