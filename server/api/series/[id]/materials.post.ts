import { getSeriesDetail } from '../../../repositories/series.repository'
import { attachMaterialToSeries } from '../../../services/series.service'
import { requireEditor } from '../../../utils/auth'
import { materialRefSchema } from '../../../utils/schemas'
import { parseOrThrow, readValidatedBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const input = await readValidatedBody(event, materialRefSchema)

  await attachMaterialToSeries(id, input)
  setResponseStatus(event, 201)
  return getSeriesDetail(id)
})
