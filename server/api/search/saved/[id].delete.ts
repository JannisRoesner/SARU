import { and, eq } from 'drizzle-orm'
import { useDatabase } from '../../../database/client'
import { savedSearches } from '../../../database/schema'
import { requireUser } from '../../../utils/auth'
import { notFound } from '../../../utils/errors'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))

  const deleted = await useDatabase()
    .delete(savedSearches)
    .where(and(eq(savedSearches.id, id), eq(savedSearches.userId, user.id)))
    .returning({ id: savedSearches.id })

  if (!deleted.length) throw notFound('Die gespeicherte Suche')
  return { erfolg: true }
})
