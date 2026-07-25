import { deleteVariant } from '../../../services/material.service'
import { requireEditor } from '../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const variantId = parseOrThrow(uuidSchema, getRouterParam(event, 'variantId'))

  await deleteVariant(variantId)
  return { erfolg: true }
})
