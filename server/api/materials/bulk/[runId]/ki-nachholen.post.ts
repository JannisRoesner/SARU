import { startKiNachholen } from '../../../../services/bulk-upload/bulk-upload.service'
import { recordAudit } from '../../../../services/audit.service'
import { requireImportLauf } from '../../../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../../../utils/validation'

/** Fordert fehlende KI-Vorschläge für die Bündel eines Stapels im Hintergrund neu an. */
export default defineEventHandler(async (event) => {
  const runId = parseOrThrow(uuidSchema, getRouterParam(event, 'runId'))
  const user = await requireImportLauf(event, runId)

  const result = await startKiNachholen(runId)

  await recordAudit(
    {
      userId: user.id,
      action: 'material.stapel.ki_nachgeholt',
      entityType: 'import',
      entityId: runId,
      details: { buendel: result.gesamt },
    },
    event,
  )

  return result
})
