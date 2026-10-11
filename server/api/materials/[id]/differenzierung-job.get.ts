import { getLatestDifferentiationJob } from '../../../services/ai/differenzierung/service'
import { requireMaterialBearbeiten } from '../../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/** Letzten Differenzierungsjob des Materials für das Status-Polling liefern. */
export default defineEventHandler(async (event) => {
  const materialId = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const user = await requireMaterialBearbeiten(event, materialId)
  const job = await getLatestDifferentiationJob(materialId, user.id)
  return { job }
})
