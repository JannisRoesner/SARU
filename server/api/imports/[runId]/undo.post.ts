import { undoImport } from '../../../services/import/importer'
import { recordAudit } from '../../../services/audit.service'
import { requireImportLauf } from '../../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/** Schritt 10: Import zurücknehmen – entfernt nur unveränderte, neu angelegte Datensätze. */
export default defineEventHandler(async (event) => {
  const runId = parseOrThrow(uuidSchema, getRouterParam(event, 'runId'))
  const user = await requireImportLauf(event, runId)

  const result = await undoImport(runId)
  await recordAudit(
    {
      userId: user.id,
      action: 'import.rueckgaengig',
      entityType: 'import',
      entityId: runId,
      details: result.removed,
    },
    event,
  )

  return result
})
