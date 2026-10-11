import { deleteMaterial } from '../../../services/material.service'
import { recordAudit } from '../../../services/audit.service'
import { requireMaterialLoeschen } from '../../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const user = await requireMaterialLoeschen(event, id)

  await deleteMaterial(id)
  await recordAudit(
    { userId: user.id, action: 'material.geloescht', entityType: 'material', entityId: id },
    event,
  )

  return { erfolg: true }
})
