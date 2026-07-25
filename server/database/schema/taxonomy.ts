import {
  type AnyPgColumn,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { schoolFormEnum } from './enums'

/** Fächer, z. B. Biologie, Deutsch, Mathematik. */
export const subjects = pgTable('subjects', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull().unique(),
  shortName: text(),
  color: text().notNull().default('#3b82f6'),
  icon: text(),
  sortOrder: integer().notNull().default(0),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

/** Konkrete Lerngruppe/Klasse eines Schuljahres, z. B. „Biologie 09b (2024/25)“. */
export const learningGroups = pgTable(
  'learning_groups',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    subjectId: uuid().references(() => subjects.id, { onDelete: 'set null' }),
    gradeLevel: integer(),
    schoolYear: text(),
    schoolForm: schoolFormEnum(),
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('learning_groups_name_year_uq').on(t.name, t.schoolYear),
    index('learning_groups_subject_idx').on(t.subjectId),
  ],
)

/** Themen mit optionalem Unterthema über die Selbstreferenz `parentId`. */
export const topics = pgTable(
  'topics',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    parentId: uuid().references((): AnyPgColumn => topics.id, { onDelete: 'cascade' }),
    subjectId: uuid().references(() => subjects.id, { onDelete: 'set null' }),
    description: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('topics_name_parent_uq').on(t.name, t.parentId),
    index('topics_parent_idx').on(t.parentId),
    index('topics_subject_idx').on(t.subjectId),
  ],
)

export const tags = pgTable('tags', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull().unique(),
  color: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const competencies = pgTable(
  'competencies',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    /** Kompetenzbereich, z. B. „Erkenntnisgewinnung“ oder „Kommunikation“. */
    area: text(),
    description: text(),
    subjectId: uuid().references(() => subjects.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('competencies_name_subject_uq').on(t.name, t.subjectId),
    index('competencies_subject_idx').on(t.subjectId),
  ],
)

export type Subject = typeof subjects.$inferSelect
export type LearningGroup = typeof learningGroups.$inferSelect
export type Topic = typeof topics.$inferSelect
export type Tag = typeof tags.$inferSelect
export type Competency = typeof competencies.$inferSelect
