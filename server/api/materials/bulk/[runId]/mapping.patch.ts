import { updateBulkMapping } from '../../../../services/bulk-upload/bulk-upload.service'
import { requireImportLauf } from '../../../../utils/permissions'
import { bulkUploadMappingSchema } from '../../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const runId = parseOrThrow(uuidSchema, getRouterParam(event, 'runId'))
  await requireImportLauf(event, runId)
  const mapping = await readZodBody(event, bulkUploadMappingSchema)
  await updateBulkMapping(runId, mapping)
  return { erfolg: true }
})
