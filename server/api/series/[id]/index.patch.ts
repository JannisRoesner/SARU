import { getSeriesDetail } from '../../../repositories/series.repository'
import { updateSeries } from '../../../services/series.service'
import { requireEditor } from '../../../utils/auth'
import { seriesUpdateSchema } from '../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const patch = await readZodBody(event, seriesUpdateSchema)

  await updateSeries(id, patch)
  return getSeriesDetail(id)
})
