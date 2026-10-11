import { getLessonDetail } from '../../../../repositories/lesson.repository'
import { reorderPhases } from '../../../../services/lesson.service'
import { requireLessonBearbeiten } from '../../../../utils/permissions'
import { reorderSchema } from '../../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  await requireLessonBearbeiten(event, id)
  const { ids } = await readZodBody(event, reorderSchema)

  await reorderPhases(id, ids)
  return getLessonDetail(id)
})
