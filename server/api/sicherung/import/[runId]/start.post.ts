import { z } from 'zod'
import { recordAudit } from '../../../../services/audit.service'
import { sicherungImportStarten, sicherungLauf } from '../../../../services/sicherung/import.service'
import { requireAdmin } from '../../../../utils/auth'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../../utils/validation'

const auswahlSchema = z.object({
  eintraege: z.array(uuidSchema).min(1, 'Bitte mindestens einen Eintrag auswählen.'),
  inhaltsgleicheAnlegen: z.boolean().default(false),
})

/** Startet den Import der Auswahl im Hintergrund; der Fortschritt kommt über GET. */
export default defineEventHandler(async (event) => {
  const user = await requireAdmin(event)
  const runId = parseOrThrow(uuidSchema, getRouterParam(event, 'runId'))
  const auswahl = await readZodBody(event, auswahlSchema)

  await sicherungImportStarten(runId, auswahl, user.id)
  await recordAudit(
    {
      userId: user.id,
      action: 'sicherung.import_gestartet',
      entityType: 'import',
      entityId: runId,
      details: { eintraege: auswahl.eintraege.length, inhaltsgleicheAnlegen: auswahl.inhaltsgleicheAnlegen },
    },
    event,
  )

  setResponseStatus(event, 202)
  return sicherungLauf(runId)
})
