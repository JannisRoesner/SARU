import { sicherungLauf } from '../../../../services/sicherung/import.service'
import { requireAdmin } from '../../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const runId = parseOrThrow(uuidSchema, getRouterParam(event, 'runId'))
  return sicherungLauf(runId)
})
