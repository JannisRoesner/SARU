import { getMaterialDetail } from '../../../repositories/material.repository'
import { addRelation } from '../../../services/material.service'
import { requireEditor } from '../../../utils/auth'
import { relationSchema } from '../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const { targetId, relationType, note } = await readZodBody(event, relationSchema)

  await addRelation(id, targetId, relationType, note)
  return getMaterialDetail(id)
})
