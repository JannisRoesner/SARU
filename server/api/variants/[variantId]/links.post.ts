import { addLinkAsset } from '../../../services/material.service'
import { requireEditor } from '../../../utils/auth'
import { linkAssetSchema } from '../../../utils/schemas'
import { parseOrThrow, readValidatedBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const variantId = parseOrThrow(uuidSchema, getRouterParam(event, 'variantId'))
  const input = await readValidatedBody(event, linkAssetSchema)

  const id = await addLinkAsset(variantId, input)
  setResponseStatus(event, 201)
  return { id }
})
