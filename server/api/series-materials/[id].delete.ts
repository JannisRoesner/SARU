import { detachMaterialFromSeries } from '../../services/series.service'
import { requireEditor } from '../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))

  await detachMaterialFromSeries(id)
  return { erfolg: true }
})
