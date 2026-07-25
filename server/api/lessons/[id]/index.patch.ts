import { getLessonDetail } from '../../../repositories/lesson.repository'
import { updateLesson } from '../../../services/lesson.service'
import { requireEditor } from '../../../utils/auth'
import { lessonUpdateSchema } from '../../../utils/schemas'
import { parseOrThrow, readValidatedBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const patch = await readValidatedBody(event, lessonUpdateSchema)

  await updateLesson(id, patch)
  return getLessonDetail(id)
})
