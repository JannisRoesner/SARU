import { z } from 'zod'
import { setArchived } from '../../../services/material.service'
import { recordAudit } from '../../../services/audit.service'
import { requireEditor } from '../../../utils/auth'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const { isArchived } = await readZodBody(event, z.object({ isArchived: z.boolean() }))

  await setArchived(id, isArchived)
  await recordAudit(
    {
      userId: user.id,
      action: isArchived ? 'material.archiviert' : 'material.reaktiviert',
      entityType: 'material',
      entityId: id,
    },
    event,
  )

  return { isArchived }
})
