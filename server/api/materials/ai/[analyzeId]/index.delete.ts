import { discardAiMaterialCreate } from '../../../../services/ai/material-create'
import { requireEditor } from '../../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const analyzeId = getRouterParam(event, 'analyzeId')
  if (!analyzeId) throw createError({ statusCode: 400, statusMessage: 'analyzeId fehlt' })

  await discardAiMaterialCreate(analyzeId)
  setResponseStatus(event, 204)
  return null
})
