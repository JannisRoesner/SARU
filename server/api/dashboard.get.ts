import { sql } from 'drizzle-orm'
import { queryRows, useDatabase, type Database } from '../database/client'
import { listMaterials } from '../repositories/material.repository'
import { getRecentSeries } from '../repositories/series.repository'
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
  await requireUser(event)
  const db = useDatabase()

  const [faecher, lehrwerke, materialien, reihen, counts] = await Promise.all([
    listDashboardFaecher(db),
    listMaterials({
      filters: { materialTypes: ['lehrwerk'] },
      sort: 'datum_neu',
      pageSize: 6,
    }),
    listMaterials({
      filters: { excludeMaterialTypes: ['lehrwerk'] },
      sort: 'datum_neu',
      pageSize: 6,
    }),
    getRecentSeries(4),
    db.execute<{
      materialien: number
      lehrwerke: number
      stunden: number
      reihen: number
      anhaenge: number
      kiLoesungen: number
    }>(sql`select
      (select count(*)::int from materials where not is_archived and material_type <> 'lehrwerk') as materialien,
      (select count(*)::int from materials where not is_archived and material_type = 'lehrwerk') as lehrwerke,
      (select count(*)::int from lessons) as stunden,
      (select count(*)::int from series where status <> 'archiviert') as reihen,
      (select count(*)::int from material_assets where kind = 'datei') as anhaenge,
      (select count(*)::int from materials where origin = 'ki') as "kiLoesungen"`),
  ])

  return {
    faecher,
    lehrwerke: lehrwerke.items,
    materialien: materialien.items,
    reihen,
    kennzahlen: counts[0] ?? {
      materialien: 0,
      lehrwerke: 0,
      stunden: 0,
      reihen: 0,
      anhaenge: 0,
      kiLoesungen: 0,
    },
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
