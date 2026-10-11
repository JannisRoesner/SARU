import { getLessonDetail } from '../../../repositories/lesson.repository'
import { attachMaterial } from '../../../services/lesson.service'
import { requireLessonBearbeiten } from '../../../utils/permissions'
import { lessonMaterialSchema } from '../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  await requireLessonBearbeiten(event, id)
  const input = await readZodBody(event, lessonMaterialSchema)

  await attachMaterial(id, input)
  setResponseStatus(event, 201)
  return getLessonDetail(id)
})
