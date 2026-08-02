import { getMaterialDetail } from '../../../../repositories/material.repository'
import { reorderVariants } from '../../../../services/material.service'
import { requireEditor } from '../../../../utils/auth'
import { reorderSchema } from '../../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const { ids } = await readZodBody(event, reorderSchema)

  await reorderVariants(id, ids)
  return getMaterialDetail(id)
})
