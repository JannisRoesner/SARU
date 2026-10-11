import { getMaterialDetail } from '../../../../repositories/material.repository'
import { reorderVariants } from '../../../../services/material.service'
import { requireMaterialBearbeiten } from '../../../../utils/permissions'
import { reorderSchema } from '../../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  await requireMaterialBearbeiten(event, id)
  const { ids } = await readZodBody(event, reorderSchema)

  await reorderVariants(id, ids)
  return getMaterialDetail(id)
})
