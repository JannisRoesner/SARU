import { getSeriesDetail } from '../../../repositories/series.repository'
import { attachMaterialToSeries } from '../../../services/series.service'
import { requireSeriesBearbeiten } from '../../../utils/permissions'
import { materialRefSchema } from '../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  await requireSeriesBearbeiten(event, id)
  const input = await readZodBody(event, materialRefSchema)

  await attachMaterialToSeries(id, input)
  setResponseStatus(event, 201)
  return getSeriesDetail(id)
})
