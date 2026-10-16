import { cancelBulkUpload } from '../../../../services/bulk-upload/bulk-upload.service'
import { recordAudit } from '../../../../services/audit.service'
import { requireImportLauf } from '../../../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const runId = parseOrThrow(uuidSchema, getRouterParam(event, 'runId'))
  const user = await requireImportLauf(event, runId)

  await cancelBulkUpload(runId)

  await recordAudit(
    {
      userId: user.id,
      action: 'material.stapel.abgebrochen',
      entityType: 'import',
      entityId: runId,
    },
    event,
  )

  return { erfolg: true }
})
