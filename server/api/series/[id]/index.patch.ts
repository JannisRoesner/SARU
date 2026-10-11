import { getSeriesDetail } from '../../../repositories/series.repository'
import { updateSeries } from '../../../services/series.service'
import { requireSeriesBearbeiten } from '../../../utils/permissions'
import { seriesUpdateSchema } from '../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  await requireSeriesBearbeiten(event, id)
  const patch = await readZodBody(event, seriesUpdateSchema)

  await updateSeries(id, patch)
  return getSeriesDetail(id)
})
