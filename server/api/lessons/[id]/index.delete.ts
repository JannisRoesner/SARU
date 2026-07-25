import { deleteLesson } from '../../../services/lesson.service'
import { recordAudit } from '../../../services/audit.service'
import { requireEditor } from '../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))

  await deleteLesson(id)
  await recordAudit(
    { userId: user.id, action: 'stunde.geloescht', entityType: 'unterrichtsstunde', entityId: id },
    event,
  )

  return { erfolg: true }
})
