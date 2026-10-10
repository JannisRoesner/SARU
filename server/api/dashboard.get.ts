import { desc, eq, sql } from 'drizzle-orm'
import { queryRows, useDatabase, type Database } from '../database/client'
import { savedSearches } from '../database/schema'
import { listMaterials } from '../repositories/material.repository'
import { getRecentSeries } from '../repositories/series.repository'
import { getAiSettings, getCollaboraSettings } from '../services/settings.service'
import { requireUser } from '../utils/auth'

export type DashboardFach = {
  id: string
  name: string
  color: string
  materialien: number
  lehrwerke: number
  reihen: number
}

/** Alles, was die Startseite braucht, in einem Aufruf. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const db = useDatabase()

  const [faecher, favoriten, zuletztVerwendet, zuletztBearbeitet, reihen, counts, ai, collabora, suchen] =
    await Promise.all([
      listDashboardFaecher(db),
      listMaterials({ filters: { onlyFavorites: true }, sort: 'zuletzt_verwendet', pageSize: 6 }),
      listMaterials({ sort: 'zuletzt_verwendet', pageSize: 6 }),
      listMaterials({ sort: 'datum_neu', pageSize: 6 }),
      getRecentSeries(4),
      db.execute<{
        materialien: number
        lehrwerke: number
        stunden: number
        reihen: number
      }>(sql`select
        (select count(*)::int from materials where not is_archived and material_type <> 'lehrwerk') as materialien,
        (select count(*)::int from materials where not is_archived and material_type = 'lehrwerk') as lehrwerke,
        (select count(*)::int from lessons) as stunden,
        (select count(*)::int from series where status <> 'archiviert') as reihen`),
      getAiSettings(),
      getCollaboraSettings(),
      db
        .select({ id: savedSearches.id, name: savedSearches.name, query: savedSearches.query })
        .from(savedSearches)
        .where(eq(savedSearches.userId, user.id))
        .orderBy(desc(savedSearches.lastUsedAt), desc(savedSearches.createdAt))
        .limit(5),
    ])

  return {
    faecher,
    // „Zuletzt verwendet“ zeigt nur Material, das wirklich schon geöffnet/benutzt wurde.
    zuletztVerwendet: zuletztVerwendet.items.filter((material) => material.lastUsedAt),
    favoriten: favoriten.items,
    zuletztBearbeitet: zuletztBearbeitet.items,
    reihen,
    gespeicherteSuchen: suchen,
    // Nur Ja/Nein für die „Erste Schritte“ – keine Einstellungswerte.
    einrichtung: {
      ki: ai.enabled && Boolean(ai.chatModel || ai.visionModel),
      office: collabora.enabled && Boolean(collabora.baseUrl.trim()),
    },
    kennzahlen: counts[0] ?? { materialien: 0, lehrwerke: 0, stunden: 0, reihen: 0 },
  }
})

async function listDashboardFaecher(db: Database): Promise<DashboardFach[]> {
  const rows = await queryRows<DashboardFach>(
    db,
    sql`select s.id, s.name, s.color,
      (
        select count(*)::int
        from material_subjects ms
        join materials m on m.id = ms.material_id
        where ms.subject_id = s.id
          and not m.is_archived
          and m.material_type <> 'lehrwerk'
      ) as materialien,
      (
        select count(*)::int
        from material_subjects ms
        join materials m on m.id = ms.material_id
        where ms.subject_id = s.id
          and not m.is_archived
          and m.material_type = 'lehrwerk'
      ) as lehrwerke,
      (
        select count(*)::int
        from series r
        where r.subject_id = s.id
          and r.status <> 'archiviert'
      ) as reihen
    from subjects s
    order by s.sort_order, s.name`,
  )

  return rows.filter((fach) => fach.materialien + fach.lehrwerke + fach.reihen > 0)
}
