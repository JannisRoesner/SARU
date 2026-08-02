import { getLessonDetail } from '../../../repositories/lesson.repository'
import { attachMaterial } from '../../../services/lesson.service'
import { requireEditor } from '../../../utils/auth'
import { lessonMaterialSchema } from '../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const input = await readZodBody(event, lessonMaterialSchema)

  await attachMaterial(id, input)
  setResponseStatus(event, 201)
  return getLessonDetail(id)
})
