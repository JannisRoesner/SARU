import { deleteLesson } from '../../../services/lesson.service'
import { recordAudit } from '../../../services/audit.service'
import { requireLessonLoeschen } from '../../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const user = await requireLessonLoeschen(event, id)

  await deleteLesson(id)
  await recordAudit(
    { userId: user.id, action: 'stunde.geloescht', entityType: 'unterrichtsstunde', entityId: id },
    event,
  )

  return { erfolg: true }
})
