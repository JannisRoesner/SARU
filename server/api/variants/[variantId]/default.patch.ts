import { setDefaultVariant } from '../../../services/material.service'
import { requireVariantBearbeiten } from '../../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const variantId = parseOrThrow(uuidSchema, getRouterParam(event, 'variantId'))
  await requireVariantBearbeiten(event, variantId)

  await setDefaultVariant(variantId)
  return { erfolg: true }
})
