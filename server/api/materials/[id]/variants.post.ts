import { getMaterialDetail } from '../../../repositories/material.repository'
import { addVariant } from '../../../services/material.service'
import { requireEditor } from '../../../utils/auth'
import { variantCreateSchema } from '../../../utils/schemas'
import { parseOrThrow, readValidatedBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const input = await readValidatedBody(event, variantCreateSchema)

  await addVariant(id, input)
  setResponseStatus(event, 201)
  return getMaterialDetail(id)
})
