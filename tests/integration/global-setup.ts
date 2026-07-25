import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

/**
 * Legt die Testdatenbank an und wendet alle Migrationen an.
 * Die Verbindungszeichenfolge kommt aus TEST_DATABASE_URL; standardmäßig wird
 * der Entwicklungscontainer auf Port 5433 verwendet.
 */
export default async function setup() {
  const url =
    process.env.TEST_DATABASE_URL ?? 'postgres://saru:saru@localhost:5433/saru_test'

  const target = new URL(url)
  const databaseName = target.pathname.slice(1)

  const adminUrl = new URL(url)
  adminUrl.pathname = '/postgres'

  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} })
  try {
    const existing = await admin`select 1 from pg_database where datname = ${databaseName}`
    if (existing.length === 0) {
      await admin.unsafe(`create database "${databaseName}"`)
    }
  } finally {
    await admin.end({ timeout: 5 })
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} })
  try {
    await sql.unsafe('create extension if not exists vector')
    await sql.unsafe('create extension if not exists pg_trgm')
    await sql.unsafe('create extension if not exists unaccent')

    await migrate(drizzle(sql), {
      migrationsFolder: resolve(
        fileURLToPath(new URL('.', import.meta.url)),
        '../../server/database/migrations',
      ),
    })
  } finally {
    await sql.end({ timeout: 5 })
  }

  // Damit alle Testdateien dieselbe Datenbank verwenden.
  process.env.DATABASE_URL = url
  process.env.NUXT_ENCRYPTION_KEY ??= 'test-verschluesselung-mindestens-32-zeichen'
  process.env.NUXT_SESSION_SECRET ??= 'test-session-geheimnis-mindestens-32-zeichen'
}
