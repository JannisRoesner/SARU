import { getLessonDetail } from '../../../repositories/lesson.repository'
import { addPhase } from '../../../services/lesson.service'
import { requireEditor } from '../../../utils/auth'
import { lessonPhaseSchema } from '../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const input = await readZodBody(event, lessonPhaseSchema)

  await addPhase(id, input)
  setResponseStatus(event, 201)
  return getLessonDetail(id)
})
