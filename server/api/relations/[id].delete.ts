import { removeRelation } from '../../services/material.service'
import { requireEditor } from '../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))

  await removeRelation(id)
  return { erfolg: true }
})
