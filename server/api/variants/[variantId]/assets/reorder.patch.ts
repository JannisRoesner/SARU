import { reorderAssets } from '../../../../services/material.service'
import { requireEditor } from '../../../../utils/auth'
import { reorderSchema } from '../../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const variantId = parseOrThrow(uuidSchema, getRouterParam(event, 'variantId'))
  const { ids } = await readZodBody(event, reorderSchema)

  await reorderAssets(variantId, ids)
  return { erfolg: true }
})
