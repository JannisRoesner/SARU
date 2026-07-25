import { deleteMaterial } from '../../../services/material.service'
import { recordAudit } from '../../../services/audit.service'
import { requireEditor } from '../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))

  await deleteMaterial(id)
  await recordAudit(
    { userId: user.id, action: 'material.geloescht', entityType: 'material', entityId: id },
    event,
  )

  return { erfolg: true }
})
