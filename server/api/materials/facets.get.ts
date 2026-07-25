import type { MaterialFilters } from '../../repositories/material.repository'
import { getMaterialFacets } from '../../repositories/material.repository'
import { requireUser } from '../../utils/auth'
import { materialListSchema } from '../../utils/schemas'
import { readValidatedQuery } from '../../utils/validation'

/** Liefert die Filterwerte samt Trefferzahlen für die Materialsammlung. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const { page: _p, pageSize: _s, sort: _o, q: _q, ...rest } = readValidatedQuery(
    event,
    materialListSchema,
  )
  return getMaterialFacets(rest satisfies MaterialFilters)
})
