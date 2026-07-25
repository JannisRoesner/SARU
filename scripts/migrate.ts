/**
 * Wendet alle ausstehenden Datenmigrationen an.
 * Wird beim Containerstart und über `npm run db:migrate` aufgerufen.
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = resolve(here, '../server/database/migrations')

const connectionString = process.env.DATABASE_URL ?? process.env.NUXT_DATABASE_URL

if (!connectionString) {
  console.error('[migrate] DATABASE_URL ist nicht gesetzt.')
  process.exit(1)
}

const sql = postgres(connectionString, { max: 1, onnotice: () => {} })

try {
  console.log('[migrate] Erweiterungen sicherstellen …')
  await sql.unsafe('CREATE EXTENSION IF NOT EXISTS vector')
  await sql.unsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm')
  await sql.unsafe('CREATE EXTENSION IF NOT EXISTS unaccent')

  console.log('[migrate] Migrationen anwenden …')
  await migrate(drizzle(sql), { migrationsFolder })
  console.log('[migrate] Fertig.')
} catch (error) {
  console.error('[migrate] Fehlgeschlagen:', error)
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
