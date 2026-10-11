import { getLessonDetail } from '../../../repositories/lesson.repository'
import { updateLesson } from '../../../services/lesson.service'
import { requireLessonBearbeiten } from '../../../utils/permissions'
import { lessonUpdateSchema } from '../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  await requireLessonBearbeiten(event, id)
  const patch = await readZodBody(event, lessonUpdateSchema)

  await updateLesson(id, patch)
  return getLessonDetail(id)
})
