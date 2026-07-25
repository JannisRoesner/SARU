import type { SQL } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type Database = PostgresJsDatabase<typeof schema>

let sqlClient: postgres.Sql | undefined
let dbInstance: Database | undefined

export function getConnectionString(): string {
  const url = process.env.DATABASE_URL ?? process.env.NUXT_DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL ist nicht gesetzt. Bitte die Verbindungszeichenfolge zur PostgreSQL-Datenbank konfigurieren.',
    )
  }
  return url
}

export function getSqlClient(): postgres.Sql {
  if (!sqlClient) {
    sqlClient = postgres(getConnectionString(), {
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idle_timeout: 30,
      connect_timeout: 15,
      onnotice: () => {},
      transform: { undefined: null },
    })
  }
  return sqlClient
}

export function useDatabase(): Database {
  if (!dbInstance) {
    dbInstance = drizzle(getSqlClient(), { schema, casing: 'snake_case' })
  }
  return dbInstance
}

/**
 * Führt eine handgeschriebene Abfrage aus und gibt die Zeilen typisiert zurück.
 *
 * Drizzles `execute` verlangt als Typparameter einen Typ mit Index-Signatur.
 * Unsere Zeilentypen sind bewusst als Interfaces beschrieben, damit sie in der
 * Oberfläche gut lesbar sind – diese Hilfsfunktion kapselt die nötige Umwandlung
 * an einer Stelle, statt sie über die Repositories zu verteilen.
 */
export async function queryRows<T>(db: Database, query: SQL): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[]
}

export async function closeDatabase(): Promise<void> {
  if (sqlClient) {
    await sqlClient.end({ timeout: 5 })
    sqlClient = undefined
    dbInstance = undefined
  }
}

/**
 * Legt die benötigten PostgreSQL-Erweiterungen an.
 * Muss vor den Migrationen laufen, da Indizes darauf aufbauen.
 */
export async function ensureExtensions(sql: postgres.Sql = getSqlClient()): Promise<void> {
  await sql.unsafe('CREATE EXTENSION IF NOT EXISTS vector')
  await sql.unsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm')
  await sql.unsafe('CREATE EXTENSION IF NOT EXISTS unaccent')
}

export { schema }
