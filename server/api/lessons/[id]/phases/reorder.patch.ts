import { getLessonDetail } from '../../../../repositories/lesson.repository'
import { reorderPhases } from '../../../../services/lesson.service'
import { requireEditor } from '../../../../utils/auth'
import { reorderSchema } from '../../../../utils/schemas'
import { parseOrThrow, readValidatedBody, uuidSchema } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const { ids } = await readValidatedBody(event, reorderSchema)

  await reorderPhases(id, ids)
  return getLessonDetail(id)
})
