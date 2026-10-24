import { once } from 'node:events'
import { PassThrough } from 'node:stream'
import { gruppiereLehrwerkInhalt } from '#shared/utils/lehrwerk'
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm'
import { Zip, ZipPassThrough } from 'fflate'
import { useDatabase } from '../database/client'
import { materialAssets, materialRelations, materials, materialVariants } from '../database/schema'
import { fileExists, readFileStream, sanitizeFileName } from './storage.service'

export interface ZipEintrag {
  /** Pfad innerhalb des Archivs. */
  name: string
  /** Gespeicherte Datei – oder `daten` für erzeugte Inhalte wie `abbildungen.json`. */
  storageKey?: string
  daten?: Buffer
}

/** `abbildungen.json` für eine Sammlung im ZIP – dasselbe Format wie beim Import. */
async function sammlungsManifest(materialId: string): Promise<Buffer> {
  const { abbildungenManifest } = await import('./abbildungen/abbildung.service')
  return Buffer.from(`${JSON.stringify(await abbildungenManifest(materialId), null, 2)}\n`, 'utf8')
}

async function sammlungsIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const zeilen = await useDatabase()
    .select({ id: materials.id })
    .from(materials)
    .where(and(inArray(materials.id, ids), eq(materials.materialType, 'abbildungssammlung')))
  return new Set(zeilen.map((z) => z.id))
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

  // Eine Abbildungssammlung bringt ihre Bildangaben mit, damit das ZIP wieder importierbar ist.
  if ((await sammlungsIds([materialId])).has(materialId)) {
    eintraege.push({ name: eindeutigerName('abbildungen.json', belegt), daten: await sammlungsManifest(materialId) })
  }

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

/** Ordner- bzw. Dateiname aus einem Titel – ohne Pfadtrenner und unzulässige Zeichen. */
function pfadTeil(titel: string): string {
  return sanitizeFileName(titel.replace(/[/\\]+/g, ' ')).replace(/[. ]+$/, '') || 'Material'
}

function endungVon(fileName: string | null): string {
  const punkt = fileName?.lastIndexOf('.') ?? -1
  return fileName && punkt > 0 ? fileName.slice(punkt) : ''
}

/**
 * Ein komplettes Lehrwerk in Ordnern: Schulbuch, dann je Lehrwerk-Gruppe (Serviceband,
 * Versuche, Kopiervorlagen …) ein nummerierter Ordner. Dateien tragen den Materialtitel;
 * Materialien mit mehreren Dateien, Stationen oder Lösungen bekommen einen eigenen Ordner,
 * Lösungen liegen dort in „Lösungen“.
 */
export async function sammleLehrwerkZipEintraege(
  lehrwerkId: string,
  /** Optionale Obergrenze, z. B. der Umfang eines Freigabe-Links. */
  erlaubt?: ReadonlySet<string>,
): Promise<ZipEintrag[]> {
  const db = useDatabase()
  const darf = (id: string) => !erlaubt || erlaubt.has(id)

  // Zugeordnete Materialien und – ein paar Ebenen tief – deren Stationen und Lösungen.
  const kinder = new Map<string, string[]>()
  const loesungen = new Map<string, string[]>()
  const anhaengen = (map: Map<string, string[]>, von: string, zu: string) => {
    if (!darf(zu)) return
    map.set(von, [...(map.get(von) ?? []), zu])
  }

  const direkt = await db
    .select({ id: materialRelations.fromMaterialId })
    .from(materialRelations)
    .where(and(eq(materialRelations.toMaterialId, lehrwerkId), eq(materialRelations.relationType, 'gehoert_zu')))
  const direkteIds = [...new Set(direkt.map((k) => k.id))].filter((id) => id !== lehrwerkId && darf(id))

  const bekannt = new Set<string>([lehrwerkId, ...direkteIds])
  let ebene = direkteIds
  for (let tiefe = 0; tiefe < 3 && ebene.length; tiefe += 1) {
    const zeilen = await db
      .select({
        von: materialRelations.fromMaterialId,
        zu: materialRelations.toMaterialId,
        typ: materialRelations.relationType,
      })
      .from(materialRelations)
      .where(
        or(
          and(inArray(materialRelations.toMaterialId, ebene), eq(materialRelations.relationType, 'gehoert_zu')),
          and(
            inArray(materialRelations.fromMaterialId, ebene),
            inArray(materialRelations.relationType, ['musterloesung', 'loesung']),
          ),
        ),
      )
    const naechste: string[] = []
    for (const z of zeilen) {
      const [eltern, kind, map] = z.typ === 'gehoert_zu' ? [z.zu, z.von, kinder] : [z.von, z.zu, loesungen]
      if (kind === lehrwerkId || kind === eltern) continue
      anhaengen(map, eltern, kind)
      if (!bekannt.has(kind) && darf(kind)) {
        bekannt.add(kind)
        naechste.push(kind)
      }
    }
    ebene = naechste
  }

  const ids = [...bekannt]
  const infos = new Map(
    (
      await db
        .select({ id: materials.id, title: materials.title, materialType: materials.materialType })
        .from(materials)
        .where(inArray(materials.id, ids))
    ).map((m) => [m.id, m]),
  )
  const dateien = new Map<string, Array<{ fileName: string | null; storageKey: string }>>()
  const dateiZeilen = await db
    .select({
      materialId: materials.id,
      fileName: materialAssets.fileName,
      storageKey: materialAssets.storageKey,
    })
    .from(materialAssets)
    .innerJoin(materialVariants, eq(materialAssets.variantId, materialVariants.id))
    .innerJoin(materials, eq(materialVariants.materialId, materials.id))
    .where(and(inArray(materials.id, ids), eq(materialAssets.kind, 'datei')))
    .orderBy(
      desc(materialVariants.isDefault),
      asc(materialVariants.sortOrder),
      asc(materialAssets.role),
      asc(materialAssets.sortOrder),
    )
  for (const d of dateiZeilen) {
    if (!d.storageKey) continue
    dateien.set(d.materialId, [...(dateien.get(d.materialId) ?? []), { fileName: d.fileName, storageKey: d.storageKey }])
  }

  const nachTitel = (a: string, b: string) =>
    (infos.get(a)?.title ?? '').localeCompare(infos.get(b)?.title ?? '', 'de', { numeric: true })

  // Sammlungen behalten Ordner und Dateinamen, damit ihre abbildungen.json passt.
  const manifeste = new Map<string, Buffer>()
  for (const id of ids) {
    if (infos.get(id)?.materialType === 'abbildungssammlung') manifeste.set(id, await sammlungsManifest(id))
  }

  const belegt = new Set<string>()
  const eintraege: ZipEintrag[] = []
  const platziert = new Set<string>([lehrwerkId])

  function ablegen(id: string, ordner: string) {
    if (platziert.has(id)) return
    platziert.add(id)
    const titel = pfadTeil(infos.get(id)?.title ?? 'Material')
    const eigene = dateien.get(id) ?? []
    const stationen = (kinder.get(id) ?? []).filter((k) => !platziert.has(k)).sort(nachTitel)
    const loes = (loesungen.get(id) ?? []).filter((l) => !platziert.has(l)).sort(nachTitel)
    const manifest = manifeste.get(id)
    const einzeln = eigene.length === 1 && !stationen.length && !loes.length && !manifest
    const ziel = einzeln ? ordner : `${ordner}${titel}/`

    if (manifest) eintraege.push({ name: eindeutigerName(`${ziel}abbildungen.json`, belegt), daten: manifest })
    for (const datei of eigene) {
      const name =
        eigene.length === 1 && !manifest ? `${titel}${endungVon(datei.fileName)}` : sanitizeFileName(datei.fileName ?? titel)
      eintraege.push({ name: eindeutigerName(`${ziel}${name}`, belegt), storageKey: datei.storageKey })
    }
    for (const station of stationen) ablegen(station, ziel)
    for (const loesung of loes) ablegen(loesung, `${ziel}Lösungen/`)
  }

  // Das Buch selbst.
  const buch = dateien.get(lehrwerkId) ?? []
  const buchTitel = pfadTeil(infos.get(lehrwerkId)?.title ?? 'Schulbuch')
  for (const datei of buch) {
    const name = buch.length === 1 ? `${buchTitel}${endungVon(datei.fileName)}` : sanitizeFileName(datei.fileName ?? buchTitel)
    eintraege.push({ name: eindeutigerName(`01 Schulbuch/${name}`, belegt), storageKey: datei.storageKey })
  }

  // Was schon unter einem anderen zugeordneten Material hängt (Station, Lösung), steht nicht doppelt oben.
  const untergeordnet = new Set<string>()
  for (const id of direkteIds) {
    for (const k of [...(kinder.get(id) ?? []), ...(loesungen.get(id) ?? [])]) if (k !== id) untergeordnet.add(k)
  }
  const oben = direkteIds.filter((id) => !untergeordnet.has(id))
  const rest = direkteIds.filter((id) => untergeordnet.has(id))

  const gruppen = gruppiereLehrwerkInhalt(
    [...oben, ...rest].sort(nachTitel).map((id) => ({
      id,
      materialType: infos.get(id)?.materialType ?? '',
      title: infos.get(id)?.title ?? '',
    })),
  )
  // Platzhalter je Gruppe; nummeriert wird am Ende nur, was wirklich Dateien enthält.
  const platzhalter = (index: number) => `\u0000${index}/`
  // Erst eigenständige Materialien (damit Lösungen bei ihrem Arbeitsblatt landen), dann der Rest.
  for (const nurOben of [true, false]) {
    gruppen.forEach((gruppe, index) => {
      for (const m of gruppe.eintraege) if (untergeordnet.has(m.id) !== nurOben) ablegen(m.id, platzhalter(index))
    })
  }

  let nummer = buch.length ? 2 : 1
  const ordner = new Map<string, string>()
  gruppen.forEach((gruppe, index) => {
    if (!eintraege.some((e) => e.name.startsWith(platzhalter(index)))) return
    ordner.set(platzhalter(index), `${String(nummer++).padStart(2, '0')} ${pfadTeil(gruppe.label.replace(/&/g, 'und'))}/`)
  })
  for (const e of eintraege) {
    const praefix = e.name.match(/^\0\d+\//)?.[0]
    if (praefix) e.name = `${ordner.get(praefix)}${e.name.slice(praefix.length)}`
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
      if (eintrag.daten) {
        const datei = new ZipPassThrough(eintrag.name)
        zip.add(datei)
        datei.push(new Uint8Array(eintrag.daten), true)
        continue
      }
      if (!eintrag.storageKey || !(await fileExists(eintrag.storageKey))) continue
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
