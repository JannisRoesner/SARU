import { getSeriesDetail } from '../../../repositories/series.repository'
import { requireUser } from '../../../utils/auth'
import { notFound } from '../../../utils/errors'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))

  const detail = await getSeriesDetail(id)
  if (!detail) throw notFound('Die Unterrichtsreihe')
  return detail
})
