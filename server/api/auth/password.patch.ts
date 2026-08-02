import { z } from 'zod'
import { recordAudit } from '../../services/audit.service'
import { changeOwnPassword } from '../../services/user.service'
import { requireUser } from '../../utils/auth'
import { readZodBody } from '../../utils/validation'

const schema = z.object({
  currentPassword: z.string().min(1, 'Bitte das aktuelle Passwort angeben.'),
  newPassword: z.string().min(1, 'Bitte ein neues Passwort angeben.'),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { currentPassword, newPassword } = await readZodBody(event, schema)

  await changeOwnPassword(user.id, currentPassword, newPassword)
  await recordAudit({ userId: user.id, action: 'passwort.geaendert' }, event)

  return { ok: true }
})
