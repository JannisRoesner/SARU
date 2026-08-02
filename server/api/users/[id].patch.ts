import { z } from 'zod'
import { recordAudit } from '../../services/audit.service'
import { updateUser } from '../../services/user.service'
import { requireAdmin } from '../../utils/auth'
import { invalidInput } from '../../utils/errors'
import { readZodBody, uuidSchema } from '../../utils/validation'

const schema = z.object({
  name: z.string().min(2).max(120).optional(),
  email: z.string().email('Bitte eine gültige E-Mail-Adresse angeben.').optional(),
  role: z.enum(['admin', 'lehrkraft', 'leser']).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(1).optional(),
})

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = uuidSchema.parse(getRouterParam(event, 'id'))
  const input = await readZodBody(event, schema)

  // Selbstsperre und versehentliche Selbst-Herabstufung abfangen.
  if (id === admin.id && (input.isActive === false || (input.role && input.role !== 'admin'))) {
    throw invalidInput('Das eigene Konto kann nicht deaktiviert oder herabgestuft werden.')
  }

  const user = await updateUser(id, input)
  await recordAudit(
    {
      userId: admin.id,
      action: 'benutzer.geaendert',
      entityType: 'user',
      entityId: id,
      details: { felder: Object.keys(input) },
    },
    event,
  )

  return { user }
})
