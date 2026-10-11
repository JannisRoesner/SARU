import { discardAiMaterialCreate } from '../../../../services/ai/material-create'
import { requireImportLauf } from '../../../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const analyzeId = parseOrThrow(uuidSchema, getRouterParam(event, 'analyzeId'))
  await requireImportLauf(event, analyzeId)

  await discardAiMaterialCreate(analyzeId)
  setResponseStatus(event, 204)
  return null
})
