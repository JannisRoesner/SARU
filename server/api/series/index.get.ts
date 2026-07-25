import type { SeriesFilters } from '../../repositories/series.repository'
import { listSeries } from '../../repositories/series.repository'
import { search } from '../../services/search/search.service'
import { requireUser } from '../../utils/auth'
import { seriesListSchema } from '../../utils/schemas'
import { readValidatedQuery } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const { q, page, pageSize, sort, ...rest } = readValidatedQuery(event, seriesListSchema)
  const filters: SeriesFilters = rest

  const hasQuery = Boolean(q?.trim())
  if (hasQuery) {
    const outcome = await search(q!, { entityTypes: ['reihe'], limit: 500 })
    if (!outcome.idsByType.reihe.length) {
      return { items: [], total: 0, page, pageSize, pageCount: 0, query: q }
    }
    filters.ids = outcome.idsByType.reihe
  }

  const { items, total } = await listSeries({
    filters,
    page,
    pageSize,
    sort: sort === 'relevanz' && !hasQuery ? 'datum_neu' : sort,
  })

  return { items, total, page, pageSize, pageCount: Math.ceil(total / pageSize), query: q ?? null }
})
