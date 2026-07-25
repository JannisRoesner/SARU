import { z } from 'zod'
import { getLessonDetail } from '../../../repositories/lesson.repository'
import { duplicateLesson } from '../../../services/lesson.service'
import { requireEditor } from '../../../utils/auth'
import { parseOrThrow, readValidatedBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const options = await readValidatedBody(
    event,
    z.object({
      title: z.string().max(300).optional(),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullish(),
      seriesId: uuidSchema.nullish(),
    }),
  )

  const newId = await duplicateLesson(id, user.id, options)
  setResponseStatus(event, 201)
  return getLessonDetail(newId)
})
