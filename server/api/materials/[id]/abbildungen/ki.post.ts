import { recordAudit } from '../../../../services/audit.service'
import { startAbbildungenKi } from '../../../../services/abbildungen/ki.service'
import { requireMaterialBearbeiten } from '../../../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../../../utils/validation'

/** Fehlende Bildangaben per Vision-KI ergänzen (Hintergrund, abbrechbar). */
export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const user = await requireMaterialBearbeiten(event, id)
  const anzahl = await startAbbildungenKi(id)
  await recordAudit(
    { userId: user.id, action: 'abbildungen.ki.gestartet', entityType: 'material', entityId: id, details: { anzahl } },
    event,
  )
  setResponseStatus(event, 202)
  return { anzahl }
})
