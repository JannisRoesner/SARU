import { getMaterialDetail } from '../../../repositories/material.repository'
import { duplicateMaterial } from '../../../services/material.service'
import { recordAudit } from '../../../services/audit.service'
import { requireRecht } from '../../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireRecht(event, 'anlegen')
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))

  const newId = await duplicateMaterial(id, user.id)
  await recordAudit(
    {
      userId: user.id,
      action: 'material.dupliziert',
      entityType: 'material',
      entityId: newId,
      details: { quelle: id },
    },
    event,
  )

  setResponseStatus(event, 201)
  return getMaterialDetail(newId)
})
