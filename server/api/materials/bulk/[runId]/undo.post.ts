import { undoBulkUpload } from '../../../../services/bulk-upload/bulk-upload.service'
import { recordAudit } from '../../../../services/audit.service'
import { requireEditor } from '../../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const runId = parseOrThrow(uuidSchema, getRouterParam(event, 'runId'))

  const result = await undoBulkUpload(runId)

  await recordAudit(
    {
      userId: user.id,
      action: 'material.stapel.rueckgaengig',
      entityType: 'import',
      entityId: runId,
      details: { removed: result.removed },
    },
    event,
  )

  return result
})
