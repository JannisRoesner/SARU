import { getLatestDifferentiationJob } from '../../../services/ai/differenzierung/service'
import { requireEditor } from '../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/** Letzten Differenzierungsjob des Materials für das Status-Polling liefern. */
export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const materialId = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const job = await getLatestDifferentiationJob(materialId, user.id)
  return { job }
})
