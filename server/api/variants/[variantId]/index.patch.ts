import { updateVariant } from '../../../services/material.service'
import { requireVariantBearbeiten } from '../../../utils/permissions'
import { variantUpdateSchema } from '../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const variantId = parseOrThrow(uuidSchema, getRouterParam(event, 'variantId'))
  await requireVariantBearbeiten(event, variantId)
  const patch = await readZodBody(event, variantUpdateSchema)

  await updateVariant(variantId, patch)
  return { erfolg: true }
})
