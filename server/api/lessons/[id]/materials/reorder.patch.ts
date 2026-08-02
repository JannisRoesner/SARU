import { getLessonDetail } from '../../../../repositories/lesson.repository'
import { reorderLessonMaterials } from '../../../../services/lesson.service'
import { requireEditor } from '../../../../utils/auth'
import { reorderSchema } from '../../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const { ids } = await readZodBody(event, reorderSchema)

  await reorderLessonMaterials(id, ids)
  return getLessonDetail(id)
})
