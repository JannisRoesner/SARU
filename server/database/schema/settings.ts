import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { users } from './auth'
import { aiJobKindEnum, aiJobStatusEnum, aiProviderEnum } from './enums'
import { materials } from './materials'

/**
 * Instanzweite Einstellungen als Key-Value-Ablage.
 * Geheimnisse (API-Schlüssel) werden vor dem Schreiben verschlüsselt und nie
 * im Klartext an den Client ausgeliefert.
 */
export const appSettings = pgTable('app_settings', {
  key: text().primaryKey(),
  value: jsonb().$type<unknown>(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
})

/** Protokoll aller LLM-Aufrufe – Kostenkontrolle und Nachvollziehbarkeit. */
export const aiJobs = pgTable(
  'ai_jobs',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    materialId: uuid().references(() => materials.id, { onDelete: 'cascade' }),
    /** Ergebnis-Material, sofern der Job eines angelegt hat. */
    resultMaterialId: uuid().references(() => materials.id, { onDelete: 'set null' }),
    kind: aiJobKindEnum().notNull(),
    provider: aiProviderEnum().notNull(),
    model: text().notNull(),
    status: aiJobStatusEnum().notNull().default('wartend'),
    prompt: text(),
    result: text(),
    errorMessage: text(),
    inputTokens: integer(),
    outputTokens: integer(),
    durationMs: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('ai_jobs_material_idx').on(t.materialId),
    index('ai_jobs_user_idx').on(t.userId),
    index('ai_jobs_status_idx').on(t.status),
    index('ai_jobs_created_idx').on(t.createdAt),
  ],
)

export type SolutionRunStage =
  | 'queued'
  | 'normalizing'
  | 'detecting'
  | 'planning'
  | 'solving'
  | 'validating'
  | 'rendering'
  | 'verifying'
  | 'publishing'
  | 'completed'

export interface SolutionRunIssue {
  code: string
  message: string
  taskId?: string | null
  targetIds?: string[]
  blocking: boolean
}

/**
 * Dauerhafter Checkpoint eines Musterlösungs-Laufs. Große Binärdaten liegen im
 * normalen Storage; hier werden nur deren Schlüssel und die prüfbaren
 * strukturierten Zwischenstände gespeichert.
 */
export const aiSolutionRuns = pgTable(
  'ai_solution_runs',
  {
    id: uuid().primaryKey().defaultRandom(),
    jobId: uuid()
      .notNull()
      .references(() => aiJobs.id, { onDelete: 'cascade' }),
    pipelineVersion: text().notNull().default('2'),
    sourceHash: text(),
    stage: text().$type<SolutionRunStage>().notNull().default('queued'),
    progress: integer().notNull().default(0),
    attempts: integer().notNull().default(0),
    heartbeatAt: timestamp({ withTimezone: true }),
    plan: jsonb().$type<unknown>(),
    solution: jsonb().$type<unknown>(),
    renderManifest: jsonb().$type<unknown>(),
    qualityReport: jsonb().$type<unknown>(),
    issues: jsonb().$type<SolutionRunIssue[]>().notNull().default([]),
    options: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    draftStorageKey: text(),
    draftFileName: text(),
    draftMimeType: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique('ai_solution_runs_job_unique').on(t.jobId),
    index('ai_solution_runs_stage_idx').on(t.stage),
    index('ai_solution_runs_heartbeat_idx').on(t.heartbeatAt),
  ],
)

export type AppSetting = typeof appSettings.$inferSelect
export type AiJob = typeof aiJobs.$inferSelect
export type AiSolutionRun = typeof aiSolutionRuns.$inferSelect
