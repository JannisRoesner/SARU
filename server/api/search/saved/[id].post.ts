import { and, eq, sql } from 'drizzle-orm'
import { useDatabase } from '../../../database/client'
import { savedSearches } from '../../../database/schema'
import { requireUser } from '../../../utils/auth'
import { notFound } from '../../../utils/errors'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/** Vermerkt die Nutzung, damit häufige Suchen oben stehen. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))

  const [updated] = await useDatabase()
    .update(savedSearches)
    .set({ useCount: sql`${savedSearches.useCount} + 1`, lastUsedAt: new Date() })
    .where(and(eq(savedSearches.id, id), eq(savedSearches.userId, user.id)))
    .returning()

  if (!updated) throw notFound('Die gespeicherte Suche')
  return updated
})
