import { sicherungVerwerfen } from '../../../../services/sicherung/import.service'
import { requireAdmin } from '../../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../../utils/validation'

/** Verwirft eine noch nicht gestartete Vorschau samt hochgeladener Datei. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const runId = parseOrThrow(uuidSchema, getRouterParam(event, 'runId'))
  await sicherungVerwerfen(runId)
  return { ok: true }
})
