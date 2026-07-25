import {
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './auth'
import { originEnum, seriesStatusEnum } from './enums'
import { materials, materialVariants } from './materials'
import { competencies, learningGroups, subjects, tags, topics } from './taxonomy'

/** Unterrichtsreihe – klammert mehrere Stunden zu einer thematischen Einheit. */
export const series = pgTable(
  'series',
  {
    id: uuid().primaryKey().defaultRandom(),
    title: text().notNull(),
    description: text(),
    subjectId: uuid().references(() => subjects.id, { onDelete: 'set null' }),
    learningGroupId: uuid().references(() => learningGroups.id, { onDelete: 'set null' }),
    topicId: uuid().references(() => topics.id, { onDelete: 'set null' }),
    startDate: date({ mode: 'string' }),
    endDate: date({ mode: 'string' }),
    schoolYear: text(),
    learningObjectives: text().array().notNull().default([]),
    notes: text(),
    status: seriesStatusEnum().notNull().default('planung'),
    origin: originEnum().notNull().default('manuell'),
    ownerId: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('series_subject_idx').on(t.subjectId),
    index('series_group_idx').on(t.learningGroupId),
    index('series_status_idx').on(t.status),
    index('series_updated_idx').on(t.updatedAt),
  ],
)

export const seriesCompetencies = pgTable(
  'series_competencies',
  {
    seriesId: uuid()
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    competencyId: uuid()
      .notNull()
      .references(() => competencies.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.seriesId, t.competencyId] })],
)

export const seriesTags = pgTable(
  'series_tags',
  {
    seriesId: uuid()
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    tagId: uuid()
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.seriesId, t.tagId] })],
)

/** Material, das der Reihe als Ganzes zugeordnet ist (nicht einer einzelnen Stunde). */
export const seriesMaterials = pgTable(
  'series_materials',
  {
    id: uuid().primaryKey().defaultRandom(),
    seriesId: uuid()
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    materialId: uuid()
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    variantId: uuid().references(() => materialVariants.id, { onDelete: 'set null' }),
    note: text(),
    sortOrder: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('series_materials_series_idx').on(t.seriesId),
    index('series_materials_material_idx').on(t.materialId),
  ],
)

export type Series = typeof series.$inferSelect
export type NewSeries = typeof series.$inferInsert
