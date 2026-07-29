import { commitAiMaterialCreate } from '../../../../services/ai/material-create'
import { getMaterialDetail } from '../../../../repositories/material.repository'
import { recordAudit } from '../../../../services/audit.service'
import { requireEditor } from '../../../../utils/auth'
import { aiMaterialCreateCommitSchema } from '../../../../utils/schemas'
import { readValidatedBody } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const analyzeId = getRouterParam(event, 'analyzeId')
  if (!analyzeId) throw createError({ statusCode: 400, statusMessage: 'analyzeId fehlt' })

  const input = await readValidatedBody(event, aiMaterialCreateCommitSchema)
  const { materialId } = await commitAiMaterialCreate(analyzeId, user.id, input)

  await recordAudit(
    {
      userId: user.id,
      action: 'material.ki.angelegt',
      entityType: 'material',
      entityId: materialId,
      details: { titel: input.title, analyseId: analyzeId },
    },
    event,
  )

  setResponseStatus(event, 201)
  return getMaterialDetail(materialId)
})
