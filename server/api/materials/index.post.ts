import { getMaterialDetail } from '../../repositories/material.repository'
import { createMaterial } from '../../services/material.service'
import { recordAudit } from '../../services/audit.service'
import { requireEditor } from '../../utils/auth'
import { materialCreateSchema } from '../../utils/schemas'
import { readValidatedBody } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const input = await readValidatedBody(event, materialCreateSchema)

  const id = await createMaterial(input, user.id)
  await recordAudit(
    {
      userId: user.id,
      action: 'material.erstellt',
      entityType: 'material',
      entityId: id,
      details: { titel: input.title },
    },
    event,
  )

  setResponseStatus(event, 201)
  return getMaterialDetail(id)
})
