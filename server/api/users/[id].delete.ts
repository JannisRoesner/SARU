import { recordAudit } from '../../services/audit.service'
import { deleteUser } from '../../services/user.service'
import { requireAdmin } from '../../utils/auth'
import { invalidInput } from '../../utils/errors'
import { uuidSchema } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = uuidSchema.parse(getRouterParam(event, 'id'))

  if (id === admin.id) {
    throw invalidInput('Das eigene Konto kann nicht gelöscht werden.')
  }

  await deleteUser(id)
  await recordAudit({ userId: admin.id, action: 'benutzer.geloescht', entityType: 'user', entityId: id }, event)

  return { ok: true }
})
