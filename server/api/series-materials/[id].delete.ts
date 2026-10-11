import { detachMaterialFromSeries } from '../../services/series.service'
import { requireSeriesMaterialBearbeiten } from '../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  await requireSeriesMaterialBearbeiten(event, id)

  await detachMaterialFromSeries(id)
  return { erfolg: true }
})
