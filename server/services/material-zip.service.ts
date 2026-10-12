import { once } from 'node:events'
import { PassThrough } from 'node:stream'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { Zip, ZipPassThrough } from 'fflate'
import { useDatabase } from '../database/client'
import { materialAssets, materialRelations, materials, materialVariants } from '../database/schema'
import { fileExists, readFileStream, sanitizeFileName } from './storage.service'

export interface ZipEintrag {
  /** Pfad innerhalb des Archivs. */
  name: string
  storageKey: string
}

/** Macht Namen im Archiv eindeutig: `a.pdf`, `a (2).pdf` … */
export function eindeutigerName(name: string, belegt: Set<string>): string {
  if (!belegt.has(name.toLowerCase())) {
    belegt.add(name.toLowerCase())
    return name
  }
  const punkt = name.lastIndexOf('.')
  const stamm = punkt > 0 ? name.slice(0, punkt) : name
  const endung = punkt > 0 ? name.slice(punkt) : ''
  for (let i = 2; ; i += 1) {
    const kandidat = `${stamm} (${i})${endung}`
    if (!belegt.has(kandidat.toLowerCase())) {
      belegt.add(kandidat.toLowerCase())
      return kandidat
    }
  }
}

/**
 * Alle Dateien eines Materials und der ihm per `gehoert_zu` zugeordneten Materialien
 * samt deren Musterlösungen. Lösungen landen im Unterordner „Lösungen“.
 */
export async function sammleZipEintraege(
  materialId: string,
  /** Optionale Obergrenze, z. B. der Umfang eines Freigabe-Links. */
  erlaubt?: ReadonlySet<string>,
): Promise<ZipEintrag[]> {
  const db = useDatabase()

  const kinder = await db
    .select({ id: materialRelations.fromMaterialId })
    .from(materialRelations)
    .where(and(eq(materialRelations.toMaterialId, materialId), eq(materialRelations.relationType, 'gehoert_zu')))
  const kindIds = kinder.map((k) => k.id).filter((id) => !erlaubt || erlaubt.has(id))

  const loesungen = kindIds.length
    ? await db
        .select({ id: materialRelations.toMaterialId })
        .from(materialRelations)
        .where(
          and(
            inArray(materialRelations.fromMaterialId, kindIds),
            inArray(materialRelations.relationType, ['musterloesung', 'loesung']),
          ),
        )
    : []
  const loesungIds = [...new Set(loesungen.map((l) => l.id))].filter(
    (id) => !kindIds.includes(id) && id !== materialId && (!erlaubt || erlaubt.has(id)),
  )

  const gruppen: Array<{ ids: string[]; ordner: string }> = [
    { ids: [materialId], ordner: '' },
    { ids: kindIds, ordner: '' },
    { ids: loesungIds, ordner: 'Lösungen/' },
  ]

  const belegt = new Set<string>()
  const eintraege: ZipEintrag[] = []

  for (const gruppe of gruppen) {
    if (!gruppe.ids.length) continue
    const zeilen = await db
      .select({
        materialTitel: materials.title,
        fileName: materialAssets.fileName,
        storageKey: materialAssets.storageKey,
      })
      .from(materialAssets)
      .innerJoin(materialVariants, eq(materialAssets.variantId, materialVariants.id))
      .innerJoin(materials, eq(materialVariants.materialId, materials.id))
      .where(and(inArray(materials.id, gruppe.ids), eq(materialAssets.kind, 'datei')))
      .orderBy(
        asc(materials.title),
        desc(materialVariants.isDefault),
        asc(materialVariants.sortOrder),
        asc(materialAssets.role),
        asc(materialAssets.sortOrder),
      )

    for (const zeile of zeilen) {
      if (!zeile.storageKey) continue
      const name = sanitizeFileName(zeile.fileName ?? zeile.materialTitel) || 'datei'
      eintraege.push({ name: eindeutigerName(`${gruppe.ordner}${name}`, belegt), storageKey: zeile.storageKey })
    }
  }

  return eintraege
}

/** Streamt die Dateien als unkomprimiertes ZIP – ohne alles im Speicher zu halten. */
export function zipStream(eintraege: ZipEintrag[]): PassThrough {
  const aus = new PassThrough()
  let blockiert = false

  const zip = new Zip((fehler, chunk, ende) => {
    if (fehler) {
      aus.destroy(fehler)
      return
    }
    if (!aus.write(chunk)) blockiert = true
    if (ende) aus.end()
  })

  void (async () => {
    for (const eintrag of eintraege) {
      if (aus.destroyed) return
      if (!(await fileExists(eintrag.storageKey))) continue
      const datei = new ZipPassThrough(eintrag.name)
      zip.add(datei)
      for await (const chunk of readFileStream(eintrag.storageKey)) {
        datei.push(chunk as Uint8Array)
        if (blockiert) {
          await Promise.race([once(aus, 'drain'), once(aus, 'close')])
          blockiert = false
          if (aus.destroyed) return
        }
      }
      datei.push(new Uint8Array(0), true)
    }
    zip.end()
  })().catch((fehler: unknown) => aus.destroy(fehler instanceof Error ? fehler : new Error(String(fehler))))

  return aus
}
