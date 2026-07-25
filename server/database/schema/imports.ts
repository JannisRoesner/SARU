import { bigint, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './auth'
import { importItemActionEnum, importLogLevelEnum, importStatusEnum } from './enums'

export type ImportStats = {
  reihen?: number
  stunden?: number
  materialien?: number
  dateien?: number
  uebersprungen?: number
  fehlgeschlagen?: number
}

/** Wie der Nutzer die erkannten Rohdaten auf interne Felder abbildet. */
export interface ImportMapping {
  /** Zielreihe: neu anlegen oder bestehende verwenden. */
  seriesMode?: 'neu' | 'bestehend' | 'keine'
  seriesId?: string | null
  seriesTitle?: string
  subjectId?: string | null
  subjectName?: string
  learningGroupId?: string | null
  learningGroupName?: string
  gradeLevel?: number | null
  schoolYear?: string
  schoolForm?: string | null
  /** Pro Quell-Datensatz: übernehmen, überspringen oder mit vorhandenem verknüpfen. */
  records?: Record<string, ImportRecordDecision>
  /** Anhänge als eigenständige Materialien anlegen. */
  createMaterials?: boolean
  /** Erkannte Dubletten automatisch verknüpfen statt neu anzulegen. */
  linkDuplicates?: boolean
  defaultLessonStatus?: string
}

export interface ImportRecordDecision {
  include: boolean
  title?: string
  duplicateOfId?: string | null
  action?: 'erstellen' | 'verknuepfen' | 'ueberspringen'
}

export const importRuns = pgTable(
  'import_runs',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    sourceFileName: text().notNull(),
    sourceSizeBytes: bigint({ mode: 'number' }),
    sourceChecksum: text(),
    /** Kennung des erkennenden Adapters, z. B. `schulportal-hessen-kursmappe-v1`. */
    adapterId: text().notNull(),
    adapterVersion: text().notNull().default('1'),
    status: importStatusEnum().notNull().default('analysiert'),
    /** Vom Parser erkannte Rohstruktur (für Vorschau und erneute Anzeige). */
    detected: jsonb().$type<Record<string, unknown>>(),
    mapping: jsonb().$type<ImportMapping>(),
    stats: jsonb().$type<ImportStats>().notNull().default({}),
    /** Temporär abgelegte Quelldatei, bis der Import bestätigt oder verworfen wird. */
    stagingPath: text(),
    errorMessage: text(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
    undoneAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('import_runs_user_idx').on(t.userId),
    index('import_runs_status_idx').on(t.status),
    index('import_runs_started_idx').on(t.startedAt),
  ],
)

/**
 * Ein Eintrag je Quell-Datensatz. Bildet die Grundlage für das Rückgängigmachen:
 * nur mit `erstellt` protokollierte Entitäten werden beim Undo entfernt.
 */
export const importRunItems = pgTable(
  'import_run_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    runId: uuid()
      .notNull()
      .references(() => importRuns.id, { onDelete: 'cascade' }),
    /** Stabile Referenz auf den Quelldatensatz, z. B. `termin:2025-06-11`. */
    sourceRef: text().notNull(),
    entityType: text().notNull(),
    entityId: uuid(),
    action: importItemActionEnum().notNull(),
    duplicateOfId: uuid(),
    message: text(),
    payload: jsonb().$type<Record<string, unknown>>(),
    /** Reihenfolge des Anlegens – das Undo läuft in umgekehrter Richtung. */
    sequence: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('import_run_items_run_idx').on(t.runId, t.sequence),
    index('import_run_items_entity_idx').on(t.entityType, t.entityId),
  ],
)

export const importLogs = pgTable(
  'import_logs',
  {
    id: uuid().primaryKey().defaultRandom(),
    runId: uuid()
      .notNull()
      .references(() => importRuns.id, { onDelete: 'cascade' }),
    level: importLogLevelEnum().notNull().default('info'),
    message: text().notNull(),
    context: jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('import_logs_run_idx').on(t.runId, t.createdAt)],
)

export type ImportRun = typeof importRuns.$inferSelect
export type ImportRunItem = typeof importRunItems.$inferSelect
export type ImportLog = typeof importLogs.$inferSelect
