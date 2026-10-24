import { getLessonSummaries } from '../../repositories/lesson.repository'
import { getMaterialSummaries } from '../../repositories/material.repository'
import { getSeriesSummaries } from '../../repositories/series.repository'
import { getAbbildungSummaries } from '../../services/abbildungen/abbildung.service'
import { recordSearch, search, type SearchHit } from '../../services/search/search.service'
import type { IndexEntityType } from '../../services/search/indexer'
import { requireUser } from '../../utils/auth'
import { searchSchema } from '../../utils/schemas'
import { readValidatedQuery } from '../../utils/validation'

/** So viele Einzelbilder zeigt die Suche ohne Typfilter zusätzlich zu den übrigen Treffern. */
const MAX_ABBILDUNGEN_NEBENBEI = 24

/**
 * Globale Suche über Materialien, Stunden und Reihen. Liefert je Treffer den
 * Textausschnitt aus dem Index und den vollständigen Datensatz, damit die
 * Oberfläche Zusammenhänge (Reihe, Stunde, Fach) direkt anzeigen kann.
 *
 * Einzelbilder aus Abbildungssammlungen kommen getrennt unter `abbildungen`, damit tausende
 * Bilder die übrigen Treffer nicht verdrängen. Mit dem Typfilter `abbildung` stehen sie in `treffer`.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { q, entityTypes, limit } = readValidatedQuery(event, searchSchema)

  if (!q.trim()) {
    return { query: q, treffer: [], abbildungen: [], anzahl: 0, vektorsucheAktiv: false }
  }

  const gewaehlt: IndexEntityType[] = entityTypes?.length
    ? entityTypes
    : ['material', 'unterrichtsstunde', 'reihe']
  // Ohne Typfilter laufen die Bilder als eigene, kleine Suche nebenher.
  const bilderNebenbei = !entityTypes?.length

  const [outcome, bilderOutcome] = await Promise.all([
    search(q, { entityTypes: gewaehlt, limit }),
    bilderNebenbei
      ? search(q, { entityTypes: ['abbildung'], limit: Math.min(limit, MAX_ABBILDUNGEN_NEBENBEI) })
      : Promise.resolve(null),
  ])

  const [materials, lessons, series, abbildungen] = await Promise.all([
    getMaterialSummaries(outcome.idsByType.material),
    getLessonSummaries(outcome.idsByType.unterrichtsstunde),
    getSeriesSummaries(outcome.idsByType.reihe),
    getAbbildungSummaries([...outcome.idsByType.abbildung, ...(bilderOutcome?.idsByType.abbildung ?? [])]),
  ])

  const byId = new Map<string, unknown>()
  for (const item of materials) byId.set(`material:${item.id}`, item)
  for (const item of lessons) byId.set(`unterrichtsstunde:${item.id}`, item)
  for (const item of series) byId.set(`reihe:${item.id}`, item)
  for (const item of abbildungen) byId.set(`abbildung:${item.id}`, item)

  // Ein Treffer ohne Datensatz kann nur durch eine parallele Löschung
  // entstehen; er wird stillschweigend übersprungen.
  const mitDatensatz = (hits: SearchHit[]) =>
    hits
      .map((hit) => {
        const datensatz = byId.get(`${hit.entityType}:${hit.entityId}`)
        return datensatz ? { ...hit, datensatz } : null
      })
      .filter((hit): hit is NonNullable<typeof hit> => hit !== null)

  const treffer = mitDatensatz(outcome.hits).slice(0, limit)
  const bildTreffer = bilderOutcome ? mitDatensatz(bilderOutcome.hits) : []

  await recordSearch(user.id, q, treffer.length + bildTreffer.length)

  return {
    query: q,
    treffer,
    abbildungen: bildTreffer,
    anzahl: treffer.length,
    vektorsucheAktiv: outcome.vectorSearchUsed || Boolean(bilderOutcome?.vectorSearchUsed),
    proTyp: {
      material: outcome.idsByType.material.length,
      unterrichtsstunde: outcome.idsByType.unterrichtsstunde.length,
      reihe: outcome.idsByType.reihe.length,
      abbildung: outcome.idsByType.abbildung.length + (bilderOutcome?.idsByType.abbildung.length ?? 0),
    },
  }
})
