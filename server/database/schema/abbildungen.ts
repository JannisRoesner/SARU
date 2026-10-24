import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { materialAssets, materials } from './materials'

/** Herkunft der KI-Angaben eines Bildes (Kennzeichnung wie bei Materialien). */
export interface AbbildungKiMeta {
  model?: string
  generatedAt?: string
  promptVersion?: string
  /** Felder, die die KI gesetzt hat. */
  felder?: string[]
}

/**
 * Ein Bild einer Abbildungssammlung.
 *
 * Die Datei selbst ist ein gewöhnlicher Anhang (`material_assets`) des Sammlungsmaterials –
 * so funktionieren Speicherung, Miniaturen, Downloads, Freigabe-Links, ZIP-Export und
 * Sicherung ohne Sonderwege. Diese Tabelle trägt die strukturierten Angaben je Bild, die ein
 * Anhang nicht hat, und ist zugleich die Einheit der Suche (ein Treffer je Bild).
 */
export const materialAbbildungen = pgTable(
  'material_abbildungen',
  {
    id: uuid().primaryKey().defaultRandom(),
    materialId: uuid()
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    assetId: uuid()
      .notNull()
      .references(() => materialAssets.id, { onDelete: 'cascade' }),
    titel: text().notNull().default(''),
    beschreibung: text(),
    /** Teilwerk, z. B. „Schülerband“, „Arbeitsbuch“. */
    werk: text(),
    /** Seitenangabe als Text („12“, „12–13“). */
    seite: text(),
    /** Abbildungsnummer, z. B. „1b“. */
    abbildung: text(),
    kapitel: text(),
    schlagwoerter: text().array().notNull().default(sql`'{}'::text[]`),
    /** `null` = unbekannt. */
    beschriftet: boolean(),
    /** Hauptbild, wenn dies eine Variante ist (z. B. die unbeschriftete Fassung). */
    varianteVon: uuid().references((): AnyPgColumn => materialAbbildungen.id, { onDelete: 'set null' }),
    /** Herkunftspfad auf der Original-CD. */
    original: text(),
    sortOrder: integer().notNull().default(0),
    /** paket | dateiname | ki | bearbeitet – steuert, welche Bilder die KI ergänzen darf. */
    herkunft: text().notNull().default('dateiname'),
    kiMeta: jsonb().$type<AbbildungKiMeta>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('material_abbildungen_asset_uq').on(t.assetId),
    index('material_abbildungen_material_idx').on(t.materialId, t.sortOrder),
    index('material_abbildungen_variante_idx').on(t.varianteVon),
  ],
)

export type MaterialAbbildung = typeof materialAbbildungen.$inferSelect
