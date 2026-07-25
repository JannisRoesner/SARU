import { commitBulkUpload } from '../../../../services/bulk-upload/bulk-upload.service'
import { recordAudit } from '../../../../services/audit.service'
import { requireEditor } from '../../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const runId = parseOrThrow(uuidSchema, getRouterParam(event, 'runId'))

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
