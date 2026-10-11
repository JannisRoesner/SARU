import { commitBulkUpload } from '../../../../services/bulk-upload/bulk-upload.service'
import { recordAudit } from '../../../../services/audit.service'
import { requireImportLauf } from '../../../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const runId = parseOrThrow(uuidSchema, getRouterParam(event, 'runId'))
  const user = await requireImportLauf(event, runId)

  const result = await commitBulkUpload(runId, user.id)

  await recordAudit(
    {
      userId: user.id,
      action: 'material.stapel.uebernommen',
      entityType: 'import',
      entityId: runId,
      details: { status: result.status, stats: result.stats },
    },
    event,
  )

  return result
})
