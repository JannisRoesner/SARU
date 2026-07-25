import { getLessonSummaries } from '../../repositories/lesson.repository'
import { getMaterialSummaries } from '../../repositories/material.repository'
import { getSeriesSummaries } from '../../repositories/series.repository'
import { recordSearch, search } from '../../services/search/search.service'
import { requireUser } from '../../utils/auth'
import { searchSchema } from '../../utils/schemas'
import { readValidatedQuery } from '../../utils/validation'

/**
 * Globale Suche über Materialien, Stunden und Reihen. Liefert je Treffer den
 * Textausschnitt aus dem Index und den vollständigen Datensatz, damit die
 * Oberfläche Zusammenhänge (Reihe, Stunde, Fach) direkt anzeigen kann.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { q, entityTypes, limit } = readValidatedQuery(event, searchSchema)

  if (!q.trim()) {
    return { query: q, treffer: [], anzahl: 0, vektorsucheAktiv: false }
  }

  const outcome = await search(q, { entityTypes, limit })

  const [materials, lessons, series] = await Promise.all([
    getMaterialSummaries(outcome.idsByType.material),
    getLessonSummaries(outcome.idsByType.unterrichtsstunde),
    getSeriesSummaries(outcome.idsByType.reihe),
  ])

  const byId = new Map<string, unknown>()
  for (const item of materials) byId.set(`material:${item.id}`, item)
  for (const item of lessons) byId.set(`unterrichtsstunde:${item.id}`, item)
  for (const item of series) byId.set(`reihe:${item.id}`, item)

  // Ein Treffer ohne Datensatz kann nur durch eine parallele Löschung
  // entstehen; er wird stillschweigend übersprungen.
  const treffer = outcome.hits
    .map((hit) => {
      const datensatz = byId.get(`${hit.entityType}:${hit.entityId}`)
      return datensatz ? { ...hit, datensatz } : null
    })
    .filter((hit): hit is NonNullable<typeof hit> => hit !== null)
    .slice(0, limit)

  await recordSearch(user.id, q, treffer.length)

  return {
    query: q,
    treffer,
    anzahl: treffer.length,
    vektorsucheAktiv: outcome.vectorSearchUsed,
    proTyp: {
      material: outcome.idsByType.material.length,
      unterrichtsstunde: outcome.idsByType.unterrichtsstunde.length,
      reihe: outcome.idsByType.reihe.length,
    },
  }
})
