import { discardImport } from '../../../services/import/importer'
import { requireImportLauf } from '../../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/** Verwirft einen noch nicht übernommenen Vorgang samt Zwischendatei. */
export default defineEventHandler(async (event) => {
  const runId = parseOrThrow(uuidSchema, getRouterParam(event, 'runId'))
  await requireImportLauf(event, runId)

  await discardImport(runId)
  return { erfolg: true }
})
