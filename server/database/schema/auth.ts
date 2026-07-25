import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { userRoleEnum } from './enums'

export interface UserPreferences {
  theme?: 'hell' | 'dunkel' | 'system'
  palette?: string
  density?: 'komfortabel' | 'kompakt'
  defaultMaterialView?: 'raster' | 'liste' | 'tabelle'
  sidebarCollapsed?: boolean
}

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull().unique(),
    name: text().notNull(),
    passwordHash: text().notNull(),
    role: userRoleEnum().notNull().default('lehrkraft'),
    isActive: boolean().notNull().default(true),
    /** Erzwingt einen Passwortwechsel, z. B. nach dem initialen Seeding. */
    mustChangePassword: boolean().notNull().default(false),
    preferences: jsonb().$type<UserPreferences>().notNull().default({}),
    lastLoginAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('users_role_idx').on(t.role)],
)

/**
 * Sessions liegen in der Datenbank, damit einzelne Anmeldungen serverseitig
 * widerrufen werden können (Cookie enthält nur das ungehashte Token).
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text().notNull().unique(),
    userAgent: text(),
    ipAddress: text(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
)

/** Revisionssichere Protokollierung sicherheits- und datenschutzrelevanter Vorgänge. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    action: text().notNull(),
    entityType: text(),
    entityId: uuid(),
    details: jsonb().$type<Record<string, unknown>>(),
    ipAddress: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_user_idx').on(t.userId),
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
    index('audit_log_created_idx').on(t.createdAt),
  ],
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Session = typeof sessions.$inferSelect
