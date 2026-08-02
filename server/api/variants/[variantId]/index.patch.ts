import { updateVariant } from '../../../services/material.service'
import { requireEditor } from '../../../utils/auth'
import { variantUpdateSchema } from '../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const variantId = parseOrThrow(uuidSchema, getRouterParam(event, 'variantId'))
  const patch = await readZodBody(event, variantUpdateSchema)

  await updateVariant(variantId, patch)
  return { erfolg: true }
})
