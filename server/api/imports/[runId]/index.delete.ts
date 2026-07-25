import { discardImport } from '../../../services/import/importer'
import { requireEditor } from '../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/** Verwirft einen noch nicht übernommenen Vorgang samt Zwischendatei. */
export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const runId = parseOrThrow(uuidSchema, getRouterParam(event, 'runId'))

  await discardImport(runId)
  return { erfolg: true }
})
