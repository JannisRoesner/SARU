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
import { lessonStatusEnum, materialUsageEnum, originEnum, socialFormEnum } from './enums'
import { materials, materialVariants } from './materials'
import { series } from './series'
import { competencies, learningGroups, subjects, tags, topics } from './taxonomy'

/** Einzelne Unterrichtsstunde, optional Teil einer Reihe. */
export const lessons = pgTable(
  'lessons',
  {
    id: uuid().primaryKey().defaultRandom(),
    title: text().notNull(),
    /** Konkretes Datum, falls die Stunde bereits terminiert ist. */
    date: date({ mode: 'string' }),
    /** Freitext für nicht datierte Stunden, z. B. „2. Woche nach den Ferien“. */
    scheduleNote: text(),
    /** Schulstunden-Raster, wie es das Schulportal liefert (z. B. 3.–4. Stunde). */
    periodFrom: integer(),
    periodTo: integer(),
    durationMinutes: integer(),
    subjectId: uuid().references(() => subjects.id, { onDelete: 'set null' }),
    learningGroupId: uuid().references(() => learningGroups.id, { onDelete: 'set null' }),
    topicId: uuid().references(() => topics.id, { onDelete: 'set null' }),
    learningObjectives: text().array().notNull().default([]),
    /** Methodischer Überblick über die gesamte Stunde. */
    methodSummary: text(),
    homework: text(),
    notes: text(),
    reflection: text(),
    substituteTeacher: text(),
    status: lessonStatusEnum().notNull().default('entwurf'),
    origin: originEnum().notNull().default('manuell'),
    seriesId: uuid().references(() => series.id, { onDelete: 'set null' }),
    /** Position innerhalb der Reihe; bestimmt die Reihenfolge im Verlaufsplan. */
    positionInSeries: integer(),
    ownerId: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('lessons_date_idx').on(t.date),
    index('lessons_series_idx').on(t.seriesId, t.positionInSeries),
    index('lessons_subject_idx').on(t.subjectId),
    index('lessons_group_idx').on(t.learningGroupId),
    index('lessons_status_idx').on(t.status),
    index('lessons_updated_idx').on(t.updatedAt),
  ],
)

/** Unterrichtsphase (Einstieg, Erarbeitung, Sicherung …). */
export const lessonPhases = pgTable(
  'lesson_phases',
  {
    id: uuid().primaryKey().defaultRandom(),
    lessonId: uuid()
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    durationMinutes: integer(),
    content: text(),
    teacherActivity: text(),
    studentActivity: text(),
    method: text(),
    socialForm: socialFormEnum(),
    notes: text(),
    sortOrder: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('lesson_phases_lesson_idx').on(t.lessonId, t.sortOrder)],
)

/** Material, das in der Stunde insgesamt verwendet wird. */
export const lessonMaterials = pgTable(
  'lesson_materials',
  {
    id: uuid().primaryKey().defaultRandom(),
    lessonId: uuid()
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    materialId: uuid()
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    variantId: uuid().references(() => materialVariants.id, { onDelete: 'set null' }),
    usage: materialUsageEnum().notNull().default('unterricht'),
    note: text(),
    sortOrder: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('lesson_materials_lesson_idx').on(t.lessonId, t.sortOrder),
    index('lesson_materials_material_idx').on(t.materialId),
  ],
)

/** Material, das einer konkreten Phase zugeordnet ist. */
export const lessonPhaseMaterials = pgTable(
  'lesson_phase_materials',
  {
    id: uuid().primaryKey().defaultRandom(),
    phaseId: uuid()
      .notNull()
      .references(() => lessonPhases.id, { onDelete: 'cascade' }),
    materialId: uuid()
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    variantId: uuid().references(() => materialVariants.id, { onDelete: 'set null' }),
    note: text(),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [
    index('lesson_phase_materials_phase_idx').on(t.phaseId, t.sortOrder),
    index('lesson_phase_materials_material_idx').on(t.materialId),
  ],
)

export const lessonCompetencies = pgTable(
  'lesson_competencies',
  {
    lessonId: uuid()
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    competencyId: uuid()
      .notNull()
      .references(() => competencies.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.lessonId, t.competencyId] })],
)

export const lessonTags = pgTable(
  'lesson_tags',
  {
    lessonId: uuid()
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    tagId: uuid()
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.lessonId, t.tagId] })],
)

export type Lesson = typeof lessons.$inferSelect
export type NewLesson = typeof lessons.$inferInsert
export type LessonPhase = typeof lessonPhases.$inferSelect
export type LessonMaterial = typeof lessonMaterials.$inferSelect
