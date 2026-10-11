import { getMaterialDetail } from '../../../repositories/material.repository'
import { addRelation } from '../../../services/material.service'
import { requireMaterialBearbeiten } from '../../../utils/permissions'
import { relationSchema } from '../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const { targetId, relationType, note, direction } = await readZodBody(event, relationSchema)
  // Eine Zuordnung gehört zu dem Material, von dem sie ausgeht.
  await requireMaterialBearbeiten(event, direction === 'eingehend' ? targetId : id)

  if (direction === 'eingehend') {
    await addRelation(targetId, id, relationType, note)
  } else {
    await addRelation(id, targetId, relationType, note)
  }
  return getMaterialDetail(id)
})
