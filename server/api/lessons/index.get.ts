import type { LessonFilters } from '../../repositories/lesson.repository'
import { listLessons } from '../../repositories/lesson.repository'
import { search } from '../../services/search/search.service'
import { requireUser } from '../../utils/auth'
import { lessonListSchema } from '../../utils/schemas'
import { readValidatedQuery } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const { q, page, pageSize, sort, ...rest } = readValidatedQuery(event, lessonListSchema)
  const filters: LessonFilters = rest

  const hasQuery = Boolean(q?.trim())
  if (hasQuery) {
    const outcome = await search(q!, { entityTypes: ['unterrichtsstunde'], limit: 500 })
    if (!outcome.idsByType.unterrichtsstunde.length) {
      return { items: [], total: 0, page, pageSize, pageCount: 0, query: q }
    }
    filters.ids = outcome.idsByType.unterrichtsstunde
  }

  const { items, total } = await listLessons({
    filters,
    page,
    pageSize,
    sort: sort === 'relevanz' && !hasQuery ? 'datum_neu' : sort,
  })

  return { items, total, page, pageSize, pageCount: Math.ceil(total / pageSize), query: q ?? null }
})
