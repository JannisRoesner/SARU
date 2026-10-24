import { and, eq, inArray, sql } from 'drizzle-orm'
import { useDatabase, type Database } from '../../database/client'
import { materialAbbildungen, searchDocuments } from '../../database/schema'
import { queueReindex } from '../search/indexer'

/**
 * Kleine Hilfen rund um den Suchindex der Einzelbilder. Bewusst ohne Abhängigkeit zum
 * Materialdienst, damit dieser sie beim Löschen und Duplizieren nutzen kann.
 */

export async function abbildungIdsDesMaterials(materialId: string, db: Database = useDatabase()): Promise<string[]> {
  const rows = await db
    .select({ id: materialAbbildungen.id })
    .from(materialAbbildungen)
    .where(eq(materialAbbildungen.materialId, materialId))
  return rows.map((row) => row.id)
}

/** Entfernt die Suchabschnitte der Bilder (auch nachdem die Zeilen schon gelöscht sind). */
export async function abbildungenAusIndexEntfernen(ids: string[], db: Database = useDatabase()): Promise<void> {
  if (!ids.length) return
  for (let i = 0; i < ids.length; i += 500) {
    await db
      .delete(searchDocuments)
      .where(and(eq(searchDocuments.entityType, 'abbildung'), inArray(searchDocuments.entityId, ids.slice(i, i + 500))))
  }
}

/** Alle Bilder einer Sammlung neu indizieren, z. B. nach Umbenennen der Sammlung. */
export async function abbildungenNeuIndizieren(materialId: string, db: Database = useDatabase()): Promise<number> {
  const ids = await abbildungIdsDesMaterials(materialId, db)
  for (const id of ids) queueReindex('abbildung', id)
  return ids.length
}

/** Suchabschnitte von Bildern, deren Zeile nicht mehr existiert (z. B. nach Löschen eines Anhangs). */
export async function verwaisteAbbildungenAusIndexEntfernen(db: Database = useDatabase()): Promise<void> {
  await db.execute(sql`
    delete from search_documents d
    where d.entity_type = 'abbildung'
      and not exists (select 1 from material_abbildungen a where a.id = d.entity_id)
  `)
}
