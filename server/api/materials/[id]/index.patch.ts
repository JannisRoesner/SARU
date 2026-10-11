import { getMaterialDetail } from '../../../repositories/material.repository'
import { updateMaterial } from '../../../services/material.service'
import { recordAudit } from '../../../services/audit.service'
import { requireMaterialBearbeiten } from '../../../utils/permissions'
import { materialUpdateSchema } from '../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const user = await requireMaterialBearbeiten(event, id)
  const patch = await readZodBody(event, materialUpdateSchema)

  await updateMaterial(id, patch)
  await recordAudit(
    {
      userId: user.id,
      action: 'material.geaendert',
      entityType: 'material',
      entityId: id,
      details: { felder: Object.keys(patch) },
    },
    event,
  )

  return getMaterialDetail(id)
})
