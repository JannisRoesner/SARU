import { readBody } from 'h3'
import { commitImport } from '../../../services/import/importer'
import { recordAudit } from '../../../services/audit.service'
import { requireEditor } from '../../../utils/auth'
import { importMappingSchema } from '../../../utils/schemas'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/** Schritt 7–9: Daten übernehmen; fehlerhafte Einzeldatensätze brechen nicht ab. */
export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const runId = parseOrThrow(uuidSchema, getRouterParam(event, 'runId'))
  // Leerer Body = gespeicherte Zuordnung nutzen. Früher wurde `{}` als Override
  // mit Zod-Defaults geparst und hat Schulform/Jahrgang u. a. verworfen.
  const body = await readBody(event).catch(() => undefined)
  const mapping =
    body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length > 0
      ? parseOrThrow(importMappingSchema, body)
      : undefined

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
