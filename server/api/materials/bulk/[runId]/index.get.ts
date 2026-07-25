import { getBulkRunOverview } from '../../../../services/bulk-upload/bulk-upload.service'
import { requireEditor } from '../../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const runId = parseOrThrow(uuidSchema, getRouterParam(event, 'runId'))
  return getBulkRunOverview(runId)
})
