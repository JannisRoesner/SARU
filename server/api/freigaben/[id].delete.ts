import { recordAudit } from '../../services/audit.service'
import { revokeShare } from '../../services/share.service'
import { requireUser } from '../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../utils/validation'

/** Zieht einen Link zurück; er funktioniert danach sofort nicht mehr. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  await revokeShare(id, user)
  await recordAudit(
    { userId: user.id, action: 'freigabe.widerrufen', entityType: 'freigabe', entityId: id },
    event,
  )
  setResponseStatus(event, 204)
  return null
})
