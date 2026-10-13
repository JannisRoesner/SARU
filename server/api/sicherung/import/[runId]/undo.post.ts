import { recordAudit } from '../../../../services/audit.service'
import { sicherungRueckgaengig } from '../../../../services/sicherung/import.service'
import { requireAdmin } from '../../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../../utils/validation'

/** Entfernt alles, was dieser Import angelegt hat – Vorhandenes bleibt unangetastet. */
export default defineEventHandler(async (event) => {
  const user = await requireAdmin(event)
  const runId = parseOrThrow(uuidSchema, getRouterParam(event, 'runId'))

  const result = await sicherungRueckgaengig(runId)
  await recordAudit(
    { userId: user.id, action: 'sicherung.rueckgaengig', entityType: 'import', entityId: runId, details: result.removed },
    event,
  )
  return result
})
