import { getLessonDetail } from '../../repositories/lesson.repository'
import { createLesson } from '../../services/lesson.service'
import { recordAudit } from '../../services/audit.service'
import { requireEditor } from '../../utils/auth'
import { lessonCreateSchema } from '../../utils/schemas'
import { readValidatedBody } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const input = await readValidatedBody(event, lessonCreateSchema)

  const id = await createLesson(input, user.id)
  await recordAudit(
    {
      userId: user.id,
      action: 'stunde.erstellt',
      entityType: 'unterrichtsstunde',
      entityId: id,
      details: { titel: input.title },
    },
    event,
  )

  setResponseStatus(event, 201)
  return getLessonDetail(id)
})
