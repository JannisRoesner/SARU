import { commitImport } from '../../../services/import/importer'
import { recordAudit } from '../../../services/audit.service'
import { requireEditor } from '../../../utils/auth'
import { importMappingSchema } from '../../../utils/schemas'
import { parseOrThrow, readValidatedBody, uuidSchema } from '../../../utils/validation'

/** Schritt 7–9: Daten übernehmen; fehlerhafte Einzeldatensätze brechen nicht ab. */
export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const runId = parseOrThrow(uuidSchema, getRouterParam(event, 'runId'))
  const mapping = await readValidatedBody(event, importMappingSchema.optional())

  const result = await commitImport(runId, user.id, mapping)
  await recordAudit(
    {
      userId: user.id,
      action: 'import.durchgefuehrt',
      entityType: 'import',
      entityId: runId,
      details: result.stats,
    },
    event,
  )

  return result
})
