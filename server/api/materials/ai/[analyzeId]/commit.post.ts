import { commitAiMaterialCreate } from '../../../../services/ai/material-create'
import { getMaterialDetail } from '../../../../repositories/material.repository'
import { recordAudit } from '../../../../services/audit.service'
import { requireImportLauf } from '../../../../utils/permissions'
import { aiMaterialCreateCommitSchema } from '../../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const analyzeId = parseOrThrow(uuidSchema, getRouterParam(event, 'analyzeId'))
  const user = await requireImportLauf(event, analyzeId)

  const input = await readZodBody(event, aiMaterialCreateCommitSchema)
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
