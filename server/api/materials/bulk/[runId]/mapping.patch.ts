import { updateBulkMapping } from '../../../../services/bulk-upload/bulk-upload.service'
import { requireEditor } from '../../../../utils/auth'
import { bulkUploadMappingSchema } from '../../../../utils/schemas'
import { parseOrThrow, readValidatedBody, uuidSchema } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const runId = parseOrThrow(uuidSchema, getRouterParam(event, 'runId'))
  const mapping = await readValidatedBody(event, bulkUploadMappingSchema)
  await updateBulkMapping(runId, mapping)
  return { erfolg: true }
})
