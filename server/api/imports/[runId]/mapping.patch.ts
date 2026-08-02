import { updateMapping } from '../../../services/import/importer'
import { requireEditor } from '../../../utils/auth'
import { importMappingSchema } from '../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

/** Schritt 4–5: Zuordnung der erkannten Daten auf interne Felder korrigieren. */
export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const runId = parseOrThrow(uuidSchema, getRouterParam(event, 'runId'))
  const mapping = await readZodBody(event, importMappingSchema)

  await updateMapping(runId, mapping)
  return { erfolg: true }
})
