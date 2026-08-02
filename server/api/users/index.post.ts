import { z } from 'zod'
import { recordAudit } from '../../services/audit.service'
import { createUser } from '../../services/user.service'
import { requireAdmin } from '../../utils/auth'
import { readZodBody } from '../../utils/validation'

const schema = z.object({
  email: z.string().email('Bitte eine gültige E-Mail-Adresse angeben.'),
  name: z.string().min(2, 'Bitte einen Namen angeben.').max(120),
  password: z.string().min(1, 'Bitte ein Passwort vergeben.'),
  role: z.enum(['admin', 'lehrkraft', 'leser']),
  mustChangePassword: z.boolean().default(true),
})

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const input = await readZodBody(event, schema)

  const user = await createUser(input)
  await recordAudit(
    {
      userId: admin.id,
      action: 'benutzer.angelegt',
      entityType: 'user',
      entityId: user.id,
      details: { email: user.email, role: user.role },
    },
    event,
  )

  return { user }
})
