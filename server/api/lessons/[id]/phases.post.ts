import { getLessonDetail } from '../../../repositories/lesson.repository'
import { addPhase } from '../../../services/lesson.service'
import { requireLessonBearbeiten } from '../../../utils/permissions'
import { lessonPhaseSchema } from '../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  await requireLessonBearbeiten(event, id)
  const input = await readZodBody(event, lessonPhaseSchema)

  await addPhase(id, input)
  setResponseStatus(event, 201)
  return getLessonDetail(id)
})
