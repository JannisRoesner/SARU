import { getSeriesDetail } from '../../../../repositories/series.repository'
import { reorderLessons } from '../../../../services/series.service'
import { requireSeriesBearbeiten } from '../../../../utils/permissions'
import { reorderSchema } from '../../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  await requireSeriesBearbeiten(event, id)
  const { ids } = await readZodBody(event, reorderSchema)

  await reorderLessons(id, ids)
  return getSeriesDetail(id)
})
