import { addLinkAsset } from '../../../services/material.service'
import { requireVariantBearbeiten } from '../../../utils/permissions'
import { linkAssetSchema } from '../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const variantId = parseOrThrow(uuidSchema, getRouterParam(event, 'variantId'))
  await requireVariantBearbeiten(event, variantId)
  const input = await readZodBody(event, linkAssetSchema)

  const id = await addLinkAsset(variantId, input)
  setResponseStatus(event, 201)
  return { id }
})
