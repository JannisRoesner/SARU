import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './auth'

export type FreigabeZiel = 'material' | 'reihe'
export type FreigabeRecht = 'ansehen' | 'bearbeiten'

/**
 * Freigabe-Links für Personen ohne Konto.
 * Der Schlüssel steht nur als Hash (für die Suche) und verschlüsselt (zum erneuten
 * Kopieren in der Verwaltung) in der Datenbank – nie im Klartext.
 * Umfang: ein Material (Lehrwerke samt Inhalt) oder eine Reihe samt Stunden und Material.
 */
export const shareLinks = pgTable(
  'share_links',
  {
    id: uuid().primaryKey().defaultRandom(),
    tokenHash: text().notNull().unique(),
    tokenEncrypted: text().notNull(),
    entityType: text().$type<FreigabeZiel>().notNull(),
    entityId: uuid().notNull(),
    permission: text().$type<FreigabeRecht>().notNull().default('ansehen'),
    label: text(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    lastUsedAt: timestamp({ withTimezone: true }),
    useCount: integer().notNull().default(0),
  },
  (t) => [index('share_links_entity_idx').on(t.entityType, t.entityId)],
)

export type ShareLink = typeof shareLinks.$inferSelect
