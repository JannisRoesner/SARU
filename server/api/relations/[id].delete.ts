import { removeRelation } from '../../services/material.service'
import { requireRelationBearbeiten } from '../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  await requireRelationBearbeiten(event, id)

  await removeRelation(id)
  return { erfolg: true }
})
