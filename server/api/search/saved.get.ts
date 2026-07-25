import { desc, eq } from 'drizzle-orm'
import { useDatabase } from '../../database/client'
import { savedSearches } from '../../database/schema'
import { requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  return useDatabase()
    .select()
    .from(savedSearches)
    .where(eq(savedSearches.userId, user.id))
    .orderBy(desc(savedSearches.lastUsedAt), desc(savedSearches.createdAt))
})
