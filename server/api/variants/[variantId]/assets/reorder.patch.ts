import { reorderAssets } from '../../../../services/material.service'
import { requireVariantBearbeiten } from '../../../../utils/permissions'
import { reorderSchema } from '../../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const variantId = parseOrThrow(uuidSchema, getRouterParam(event, 'variantId'))
  await requireVariantBearbeiten(event, variantId)
  const { ids } = await readZodBody(event, reorderSchema)

  await reorderAssets(variantId, ids)
  return { erfolg: true }
})
