import type { MaterialFilters } from '../../repositories/material.repository'
import { listMaterials } from '../../repositories/material.repository'
import { search } from '../../services/search/search.service'
import { requireUser } from '../../utils/auth'
import { materialListSchema } from '../../utils/schemas'
import { readValidatedQuery } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const { q, page, pageSize, sort, ...rest } = readValidatedQuery(event, materialListSchema)
  const filters: MaterialFilters = rest

  // Bei einer Textsuche liefert der Suchdienst die Kandidaten-IDs in
  // Relevanzreihenfolge; die Repository-Schicht wendet darauf die übrigen
  // Filter und die gewählte Sortierung an.
  const hasQuery = Boolean(q?.trim())
  if (hasQuery) {
    const outcome = await search(q!, { entityTypes: ['material'], limit: 500 })
    if (!outcome.idsByType.material.length) {
      return { items: [], total: 0, page, pageSize, pageCount: 0, query: q }
    }
    filters.ids = outcome.idsByType.material
  }

  const { items, total } = await listMaterials({
    filters,
    page,
    pageSize,
    sort: sort === 'relevanz' && !hasQuery ? 'datum_neu' : sort,
  })

  return { items, total, page, pageSize, pageCount: Math.ceil(total / pageSize), query: q ?? null }
})
