import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
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

export type AppSetting = typeof appSettings.$inferSelect
export type AiJob = typeof aiJobs.$inferSelect
