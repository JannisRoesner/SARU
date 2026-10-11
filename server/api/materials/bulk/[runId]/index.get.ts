import { getBulkRunOverview } from '../../../../services/bulk-upload/bulk-upload.service'
import { requireImportLauf } from '../../../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const runId = parseOrThrow(uuidSchema, getRouterParam(event, 'runId'))
  await requireImportLauf(event, runId)
  return getBulkRunOverview(runId)
})
