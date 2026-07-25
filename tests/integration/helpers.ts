import { sql } from 'drizzle-orm'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DATABASE_URL ??= 'postgres://saru:saru@localhost:5433/saru_test'
process.env.NUXT_ENCRYPTION_KEY ??= 'test-verschluesselung-mindestens-32-zeichen'
process.env.NUXT_SESSION_SECRET ??= 'test-session-geheimnis-mindestens-32-zeichen'

/** Tabellen in Abhängigkeitsreihenfolge – `truncate ... cascade` räumt den Rest ab. */
const ROOT_TABLES = [
  'search_documents',
  'search_history',
  'saved_searches',
  'import_logs',
  'import_run_items',
  'import_runs',
  'ai_jobs',
  'lesson_phase_materials',
  'lesson_phases',
  'lesson_materials',
  'lesson_competencies',
  'lesson_tags',
  'lessons',
  'series_materials',
  'series_competencies',
  'series_tags',
  'series',
  'material_assets',
  'material_variants',
  'material_relations',
  'material_subjects',
  'material_topics',
  'material_tags',
  'material_competencies',
  'material_grade_levels',
  'material_learning_groups',
  'materials',
  'competencies',
  'tags',
  'topics',
  'learning_groups',
  'subjects',
  'app_settings',
  'audit_log',
  'sessions',
  'users',
]

export async function resetDatabase(): Promise<void> {
  const { useDatabase } = await import('../../server/database/client')
  const db = useDatabase()
  await db.execute(sql.raw(`truncate table ${ROOT_TABLES.join(', ')} cascade`))
}

export async function createTestUser(
  overrides: { email?: string; role?: 'admin' | 'lehrkraft' | 'leser' } = {},
): Promise<{ id: string; email: string }> {
  const { createUser } = await import('../../server/services/user.service')
  const email = overrides.email ?? `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@saru.test`
  const user = await createUser({
    email,
    name: 'Testlehrkraft',
    password: 'TestPasswort!2025',
    role: overrides.role ?? 'lehrkraft',
  })
  return { id: user.id, email: user.email }
}

/** Isoliertes Upload-Verzeichnis, damit Tests keine Dateien im Projekt hinterlassen. */
export async function withTempUploadDir<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.NUXT_UPLOAD_DIR
  const dir = await mkdtemp(join(tmpdir(), 'saru-test-'))
  process.env.NUXT_UPLOAD_DIR = dir
  try {
    return await run()
  } finally {
    process.env.NUXT_UPLOAD_DIR = previous
    await rm(dir, { recursive: true, force: true })
  }
}

export async function closeConnections(): Promise<void> {
  const { closeDatabase } = await import('../../server/database/client')
  await closeDatabase()
}
