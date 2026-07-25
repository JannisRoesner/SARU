import { sql } from 'drizzle-orm'
import { useDatabase } from '../database/client'
import { getUpcomingLessons } from '../repositories/lesson.repository'
import { listMaterials } from '../repositories/material.repository'
import { getActiveSeries } from '../repositories/series.repository'
import { requireUser } from '../utils/auth'

/** Alles, was die Startseite braucht, in einem Aufruf. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const db = useDatabase()

  const [recent, favorites, upcoming, activeSeries, counts] = await Promise.all([
    listMaterials({ sort: 'datum_neu', pageSize: 6 }),
    listMaterials({ filters: { onlyFavorites: true }, sort: 'zuletzt_verwendet', pageSize: 6 }),
    getUpcomingLessons(6),
    getActiveSeries(4),
    db.execute<{
      materialien: number
      stunden: number
      reihen: number
      anhaenge: number
      kiLoesungen: number
    }>(sql`select
      (select count(*)::int from materials where not is_archived) as materialien,
      (select count(*)::int from lessons) as stunden,
      (select count(*)::int from series where status <> 'archiviert') as reihen,
      (select count(*)::int from material_assets where kind = 'datei') as anhaenge,
      (select count(*)::int from materials where origin = 'ki') as "kiLoesungen"`),
  ])

  return {
    zuletztBearbeitet: recent.items,
    favoriten: favorites.items,
    naechsteStunden: upcoming,
    aktiveReihen: activeSeries,
    kennzahlen: counts[0] ?? {
      materialien: 0,
      stunden: 0,
      reihen: 0,
      anhaenge: 0,
      kiLoesungen: 0,
    },
  }
})
