import { sql } from 'drizzle-orm'
import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from 'drizzle-orm/pg-core'
import { users } from './auth'
import { searchEntityTypeEnum } from './enums'
import type { GradeLevel } from '#shared/utils/jahrgangsstufen'

/**
 * Feste Dimension des Vektorindex. Embedding-Modelle mit kleinerer Ausgabe werden
 * mit Nullen aufgefüllt (verändert Kosinus-Ähnlichkeit nicht), größere werden
 * gekürzt und renormalisiert.
 */
export const EMBEDDING_DIMENSIONS = 1536

const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
})

/**
 * Ein gemeinsamer Index über Materialien, Stunden und Reihen.
 * Lange Dokumenttexte werden in mehrere Chunks zerlegt, damit die semantische
 * Suche auf sinnvoll großen Abschnitten arbeitet.
 */
export const searchDocuments = pgTable(
  'search_documents',
  {
    id: uuid().primaryKey().defaultRandom(),
    entityType: searchEntityTypeEnum().notNull(),
    entityId: uuid().notNull(),
    chunkIndex: integer().notNull().default(0),
    title: text().notNull().default(''),
    /** Zusammengefasste Metadaten (Fach, Tags, Thema …) für die Volltextsuche. */
    metaText: text().notNull().default(''),
    content: text().notNull().default(''),
    /** Quelle des Chunks, z. B. der Dateiname eines PDFs. */
    sourceLabel: text(),
    contentHash: text().notNull(),
    embedding: vector({ dimensions: EMBEDDING_DIMENSIONS }),
    embeddingModel: text(),
    embeddedAt: timestamp({ withTimezone: true }),
    tsv: tsvector()
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('german', coalesce(title, '')), 'A')
          || setweight(to_tsvector('german', coalesce(meta_text, '')), 'B')
          || setweight(to_tsvector('german', coalesce(content, '')), 'C')`,
      ),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('search_documents_entity_chunk_uq').on(t.entityType, t.entityId, t.chunkIndex),
    index('search_documents_entity_idx').on(t.entityType, t.entityId),
    index('search_documents_tsv_idx').using('gin', t.tsv),
    index('search_documents_title_trgm_idx').using('gin', sql`title gin_trgm_ops`),
    index('search_documents_embedding_idx').using(
      'hnsw',
      t.embedding.op('vector_cosine_ops'),
    ),
  ],
)

export interface SavedSearchFilters {
  subjectIds?: string[]
  topicIds?: string[]
  tagIds?: string[]
  competencyIds?: string[]
  learningGroupIds?: string[]
  gradeLevels?: GradeLevel[]
  materialTypes?: string[]
  fileTypes?: string[]
  entityTypes?: string[]
  schoolForms?: string[]
  dateFrom?: string
  dateTo?: string
  onlyFavorites?: boolean
  includeArchived?: boolean
  origin?: string[]
}

export const savedSearches = pgTable(
  'saved_searches',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    query: text().notNull().default(''),
    filters: jsonb().$type<SavedSearchFilters>().notNull().default({}),
    sort: text().notNull().default('relevanz'),
    useCount: integer().notNull().default(0),
    lastUsedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('saved_searches_user_name_uq').on(t.userId, t.name),
    index('saved_searches_user_idx').on(t.userId),
  ],
)

/** Speist Autovervollständigung und „zuletzt gesucht“. */
export const searchHistory = pgTable(
  'search_history',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    query: text().notNull(),
    resultCount: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('search_history_user_idx').on(t.userId, t.createdAt)],
)

export type SearchDocument = typeof searchDocuments.$inferSelect
export type SavedSearch = typeof savedSearches.$inferSelect
