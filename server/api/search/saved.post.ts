import { useDatabase } from '../../database/client'
import { savedSearches } from '../../database/schema'
import { requireUser } from '../../utils/auth'
import { savedSearchSchema } from '../../utils/schemas'
import { readValidatedBody } from '../../utils/validation'

/** Legt eine gespeicherte Suche an oder überschreibt die gleichnamige. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const input = await readValidatedBody(event, savedSearchSchema)

  const [saved] = await useDatabase()
    .insert(savedSearches)
    .values({ ...input, userId: user.id })
    .onConflictDoUpdate({
      target: [savedSearches.userId, savedSearches.name],
      set: { query: input.query, filters: input.filters, sort: input.sort },
    })
    .returning()

  setResponseStatus(event, 201)
  return saved
})
