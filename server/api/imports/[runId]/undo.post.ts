import { undoImport } from '../../../services/import/importer'
import { recordAudit } from '../../../services/audit.service'
import { requireEditor } from '../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/** Schritt 10: Import zurücknehmen – entfernt nur unveränderte, neu angelegte Datensätze. */
export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const runId = parseOrThrow(uuidSchema, getRouterParam(event, 'runId'))

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
