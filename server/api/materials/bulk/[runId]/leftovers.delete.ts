import { discardBulkLeftovers } from '../../../../services/bulk-upload/bulk-upload.service'
import { recordAudit } from '../../../../services/audit.service'
import { requireImportLauf } from '../../../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../../../utils/validation'

/** Verwirft die Dateien nicht angelegter Bündel; angelegte Materialien bleiben. */
export default defineEventHandler(async (event) => {
  const runId = parseOrThrow(uuidSchema, getRouterParam(event, 'runId'))
  const user = await requireImportLauf(event, runId)

  const result = await discardBulkLeftovers(runId)

  await recordAudit(
    {
      userId: user.id,
      action: 'material.stapel.reste_verworfen',
      entityType: 'import',
      entityId: runId,
      details: result,
    },
    event,
  )

  return { erfolg: true, ...result }
})
