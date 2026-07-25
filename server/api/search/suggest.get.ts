import { z } from 'zod'
import { suggest } from '../../services/search/search.service'
import { requireUser } from '../../utils/auth'
import { readValidatedQuery } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { q, limit } = readValidatedQuery(
    event,
    z.object({ q: z.string().max(200).default(''), limit: z.coerce.number().int().min(1).max(20).default(10) }),
  )

  return { vorschlaege: await suggest(q, user.id, limit) }
})
