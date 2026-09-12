import { enqueueDifferentiation } from '../../../services/ai/differenzierung/service'
import { requireEditor } from '../../../utils/auth'
import { checkRateLimit } from '../../../utils/rate-limit'
import { differentiationEnqueueSchema } from '../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

/** Stellt die Erzeugung einer Differenzierungsfassung in die Warteschlange. */
export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const options = await readZodBody(event, differentiationEnqueueSchema)

  checkRateLimit(`ki:${user.id}`, {
    limit: 20,
    windowMs: 60 * 60 * 1000,
    message: 'Es wurden zu viele KI-Anfragen gestellt. Bitte später erneut versuchen.',
  })

  const job = await enqueueDifferentiation(id, user.id, options)
  setResponseStatus(event, 202)
  return job
})
