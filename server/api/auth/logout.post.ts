import { recordAudit } from '../../services/audit.service'
import { destroySession, resolveUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await resolveUser(event)
  await destroySession(event)
  if (user) await recordAudit({ userId: user.id, action: 'abmeldung' }, event)
  return { ok: true }
})
