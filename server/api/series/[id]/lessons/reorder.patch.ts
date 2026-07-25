import { getSeriesDetail } from '../../../../repositories/series.repository'
import { reorderLessons } from '../../../../services/series.service'
import { requireEditor } from '../../../../utils/auth'
import { reorderSchema } from '../../../../utils/schemas'
import { parseOrThrow, readValidatedBody, uuidSchema } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const { ids } = await readValidatedBody(event, reorderSchema)

  await reorderLessons(id, ids)
  return getSeriesDetail(id)
})
