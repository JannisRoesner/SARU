import { and, asc, eq, inArray, isNull, max, sql } from 'drizzle-orm'
import {
  abbildungAusDateiname,
  ABBILDUNGEN_MANIFEST_VERSION,
  istAbbildungsBildDatei,
  normalisiereSchlagwoerter,
  type AbbildungHerkunft,
  type AbbildungManifest,
  type AbbildungMetadaten,
} from '#shared/utils/abbildungen'
import { queryRows, useDatabase, type Database } from '../../database/client'
import {
  materialAbbildungen,
  materialAssets,
  materials,
  materialVariants,
  type AbbildungKiMeta,
} from '../../database/schema'
import { sha256 } from '../../utils/crypto'
import { invalidInput, notFound } from '../../utils/errors'
import { createLogger } from '../../utils/logger'
import { addFileAsset, deleteAsset } from '../material.service'
import { queueReindex } from '../search/indexer'
import { abbildungenAusIndexEntfernen } from './abbildung-index'

const log = createLogger('abbildungen')

/** Ein Bild der Sammlung, wie Galerie, Großansicht und Freigabe-Links es brauchen. */
export interface AbbildungEintrag {
  id: string
  assetId: string
  fileName: string | null
  mimeType: string | null
  sizeBytes: number | null
  titel: string
  beschreibung: string | null
  werk: string | null
  seite: string | null
  abbildung: string | null
  kapitel: string | null
  schlagwoerter: string[]
  beschriftet: boolean | null
  varianteVon: string | null
  original: string | null
  reihenfolge: number
  herkunft: AbbildungHerkunft
  ki: AbbildungKiMeta | null
}

/** Zeilen ohne eigene Angaben (z. B. per „Datei hinzufügen“ hochgeladene Bilder) nachziehen. */
export async function fehlendeAbbildungenAnlegen(materialId: string, db: Database = useDatabase()): Promise<number> {
  const offen = await queryRows<{ assetId: string; fileName: string | null; sortOrder: number }>(
    db,
    sql`select a.id as "assetId", a.file_name as "fileName", a.sort_order as "sortOrder"
      from material_assets a
      join material_variants v on v.id = a.variant_id
      where v.material_id = ${materialId}::uuid and a.kind = 'datei'
        and not exists (select 1 from material_abbildungen b where b.asset_id = a.id)
      order by v.sort_order, a.sort_order`,
  )
  const bilder = offen.filter((zeile) => istAbbildungsBildDatei(zeile.fileName))
  if (!bilder.length) return 0
  const [{ hoechste } = { hoechste: null }] = await db
    .select({ hoechste: max(materialAbbildungen.sortOrder) })
    .from(materialAbbildungen)
    .where(eq(materialAbbildungen.materialId, materialId))
  let position = (hoechste ?? -1) + 1
  const neu = await db
    .insert(materialAbbildungen)
    .values(
      bilder.map((bild) => {
        const meta = abbildungAusDateiname(bild.fileName ?? 'Bild')
        return {
          materialId,
          assetId: bild.assetId,
          titel: meta.titel ?? '',
          seite: meta.seite,
          abbildung: meta.abbildung,
          beschriftet: meta.beschriftet,
          sortOrder: position++,
          herkunft: 'dateiname',
        }
      }),
    )
    .onConflictDoNothing()
    .returning({ id: materialAbbildungen.id })
  for (const { id } of neu) queueReindex('abbildung', id)
  return neu.length
}

export async function listAbbildungen(materialId: string, db: Database = useDatabase()): Promise<AbbildungEintrag[]> {
  await fehlendeAbbildungenAnlegen(materialId, db)
  return queryRows<AbbildungEintrag>(
    db,
    sql`select b.id, b.asset_id as "assetId", a.file_name as "fileName", a.mime_type as "mimeType",
        a.size_bytes::float8 as "sizeBytes",
        b.titel, b.beschreibung, b.werk, b.seite, b.abbildung, b.kapitel, b.schlagwoerter,
        b.beschriftet, b.variante_von as "varianteVon", b.original, b.sort_order as "reihenfolge",
        b.herkunft, b.ki_meta as "ki"
      from material_abbildungen b
      join material_assets a on a.id = b.asset_id
      where b.material_id = ${materialId}::uuid
      order by b.sort_order, b.created_at`,
  )
}

export async function requireAbbildung(id: string, db: Database = useDatabase()) {
  const [row] = await db.select().from(materialAbbildungen).where(eq(materialAbbildungen.id, id)).limit(1)
  if (!row) throw notFound('Die Abbildung')
  return row
}

export async function getAbbildung(id: string, db: Database = useDatabase()): Promise<AbbildungEintrag> {
  const row = await requireAbbildung(id, db)
  const eintrag = (await listAbbildungen(row.materialId, db)).find((e) => e.id === id)
  if (!eintrag) throw notFound('Die Abbildung')
  return eintrag
}

export interface AbbildungPatch {
  titel?: string
  beschreibung?: string | null
  werk?: string | null
  seite?: string | null
  abbildung?: string | null
  kapitel?: string | null
  schlagwoerter?: string[]
  beschriftet?: boolean | null
  varianteVon?: string | null
  original?: string | null
}

function leerZuNull(wert: string | null | undefined): string | null {
  const bereinigt = wert?.replace(/\s+/g, ' ').trim()
  return bereinigt ? bereinigt : null
}

/** Angaben eines Bildes ändern. Eine manuelle Änderung schützt das Bild vor späteren KI-Läufen. */
export async function abbildungAktualisieren(
  id: string,
  patch: AbbildungPatch,
  db: Database = useDatabase(),
): Promise<void> {
  const vorher = await requireAbbildung(id, db)
  const werte: Partial<typeof materialAbbildungen.$inferInsert> = { updatedAt: new Date(), herkunft: 'bearbeitet' }
  if (patch.titel !== undefined) werte.titel = patch.titel.replace(/\s+/g, ' ').trim().slice(0, 300)
  if (patch.beschreibung !== undefined) werte.beschreibung = patch.beschreibung?.trim().slice(0, 4000) || null
  if (patch.werk !== undefined) werte.werk = leerZuNull(patch.werk)
  if (patch.seite !== undefined) werte.seite = leerZuNull(patch.seite)
  if (patch.abbildung !== undefined) werte.abbildung = leerZuNull(patch.abbildung)
  if (patch.kapitel !== undefined) werte.kapitel = leerZuNull(patch.kapitel)
  if (patch.original !== undefined) werte.original = leerZuNull(patch.original)
  if (patch.schlagwoerter !== undefined) werte.schlagwoerter = normalisiereSchlagwoerter(patch.schlagwoerter)
  if (patch.beschriftet !== undefined) werte.beschriftet = patch.beschriftet
  if (patch.varianteVon !== undefined) {
    if (patch.varianteVon === null) {
      werte.varianteVon = null
    } else {
      if (patch.varianteVon === id) throw invalidInput('Ein Bild kann keine Variante von sich selbst sein.')
      const haupt = await requireAbbildung(patch.varianteVon, db)
      if (haupt.materialId !== vorher.materialId) {
        throw invalidInput('Varianten müssen zur selben Sammlung gehören.')
      }
      // Varianten hängen immer direkt am Hauptbild – keine Ketten.
      werte.varianteVon = haupt.varianteVon ?? haupt.id
      if (werte.varianteVon === id) throw invalidInput('Das gewählte Bild ist bereits eine Variante dieses Bildes.')
      // Eigene Varianten dieses Bildes wandern mit zum neuen Hauptbild.
      await db
        .update(materialAbbildungen)
        .set({ varianteVon: werte.varianteVon, updatedAt: new Date() })
        .where(eq(materialAbbildungen.varianteVon, id))
    }
  }
  await db.update(materialAbbildungen).set(werte).where(eq(materialAbbildungen.id, id))
  queueReindex('abbildung', id)
  if (patch.varianteVon !== undefined) {
    // Varianten werden nicht einzeln gefunden; der Status des Bildes und seiner Kinder ändert sich.
    const kinder = await db
      .select({ id: materialAbbildungen.id })
      .from(materialAbbildungen)
      .where(eq(materialAbbildungen.materialId, vorher.materialId))
    for (const kind of kinder) queueReindex('abbildung', kind.id)
  }
  queueReindex('material', vorher.materialId)
}

/** Bild samt Datei entfernen. Varianten bleiben als eigenständige Bilder erhalten. */
export async function abbildungLoeschen(id: string, db: Database = useDatabase()): Promise<void> {
  const row = await requireAbbildung(id, db)
  const kinder = await db
    .select({ id: materialAbbildungen.id })
    .from(materialAbbildungen)
    .where(eq(materialAbbildungen.varianteVon, id))
  await deleteAsset(row.assetId, db)
  await abbildungenAusIndexEntfernen([id], db)
  for (const kind of kinder) queueReindex('abbildung', kind.id)
}

/** Löscht die Bilder zu den angegebenen Dateien (Rückgängigmachen eines Anhängens im Stapel). */
export async function abbildungenNachAssetsLoeschen(assetIds: string[], db: Database = useDatabase()): Promise<number> {
  if (!assetIds.length) return 0
  const rows = await db
    .select({ id: materialAbbildungen.id, assetId: materialAbbildungen.assetId })
    .from(materialAbbildungen)
    .where(inArray(materialAbbildungen.assetId, assetIds))
  let entfernt = 0
  for (const assetId of assetIds) {
    try {
      await deleteAsset(assetId, db)
      entfernt += 1
    } catch (error) {
      log.warn('Bild konnte nicht entfernt werden', { assetId, error })
    }
  }
  await abbildungenAusIndexEntfernen(rows.map((row) => row.id), db)
  return entfernt
}

// --- Hinzufügen ------------------------------------------------------------------

export interface NeueAbbildung {
  /** Kennung des Aufrufers (sourceRef im Stapel, Dateiname im Upload). */
  ref: string
  dateiName: string
  laden: () => Promise<Buffer>
  metadaten: AbbildungMetadaten
  varianteVonRef: string | null
  herkunft: AbbildungHerkunft
}

export interface HinzufuegenErgebnis {
  angelegt: { ref: string; abbildungId: string; assetId: string }[]
  uebersprungen: { ref: string; dateiName: string; grund: string }[]
}

async function standardFassung(materialId: string, db: Database): Promise<string> {
  const [variante] = await db
    .select({ id: materialVariants.id })
    .from(materialVariants)
    .where(eq(materialVariants.materialId, materialId))
    .orderBy(asc(materialVariants.sortOrder))
    .limit(1)
  if (!variante) throw notFound('Die Fassung')
  return variante.id
}

/**
 * Speichert Bilder als Anhänge der Sammlung und legt ihre Angaben an. Ein fehlerhaftes Bild
 * (falsches Format, zu groß) wird übersprungen und gemeldet, die übrigen kommen trotzdem an.
 * Mit `ohneDubletten` werden Bilder übersprungen, deren Inhalt schon in der Sammlung liegt –
 * so kann ein Paket in mehreren Stapeln ankommen, ohne doppelte Bilder.
 */
export async function abbildungenHinzufuegen(
  materialId: string,
  bilder: NeueAbbildung[],
  optionen: { ohneDubletten?: boolean; nachJedemBild?: (ref: string) => Promise<void> } = {},
  db: Database = useDatabase(),
): Promise<HinzufuegenErgebnis> {
  const variantId = await standardFassung(materialId, db)
  const vorhanden = await queryRows<{ id: string; checksum: string | null; role: string }>(
    db,
    sql`select b.id, a.checksum, a.role from material_assets a
      left join material_abbildungen b on b.asset_id = a.id
      where a.variant_id = ${variantId}::uuid`,
  )
  const nachPruefsumme = new Map<string, string>()
  for (const zeile of vorhanden) if (zeile.checksum && zeile.id) nachPruefsumme.set(zeile.checksum, zeile.id)
  let hatHauptdatei = vorhanden.some((zeile) => zeile.role === 'haupt')

  const [{ hoechste } = { hoechste: null }] = await db
    .select({ hoechste: max(materialAbbildungen.sortOrder) })
    .from(materialAbbildungen)
    .where(eq(materialAbbildungen.materialId, materialId))
  let position = (hoechste ?? -1) + 1

  const ergebnis: HinzufuegenErgebnis = { angelegt: [], uebersprungen: [] }
  const idNachRef = new Map<string, string>()
  for (const bild of bilder) {
    try {
      const buffer = await bild.laden()
      const pruefsumme = sha256(buffer)
      const dublette = nachPruefsumme.get(pruefsumme)
      if (dublette && optionen.ohneDubletten) {
        idNachRef.set(bild.ref, dublette)
        ergebnis.uebersprungen.push({ ref: bild.ref, dateiName: bild.dateiName, grund: 'Schon in der Sammlung vorhanden.' })
        continue
      }
      const assetId = await addFileAsset(
        variantId,
        { buffer, fileName: bild.dateiName },
        { role: hatHauptdatei ? 'anhang' : 'haupt', title: null, skipContentAutofill: true },
        db,
      )
      hatHauptdatei = true
      const m = bild.metadaten
      const [neu] = await db
        .insert(materialAbbildungen)
        .values({
          materialId,
          assetId,
          titel: (m.titel ?? '').slice(0, 300),
          beschreibung: m.beschreibung,
          werk: m.werk,
          seite: m.seite,
          abbildung: m.abbildung,
          kapitel: m.kapitel,
          schlagwoerter: normalisiereSchlagwoerter(m.schlagwoerter),
          beschriftet: m.beschriftet,
          original: m.original,
          sortOrder: position++,
          herkunft: bild.herkunft,
        })
        .returning({ id: materialAbbildungen.id })
      idNachRef.set(bild.ref, neu!.id)
      nachPruefsumme.set(pruefsumme, neu!.id)
      ergebnis.angelegt.push({ ref: bild.ref, abbildungId: neu!.id, assetId })
      if (optionen.nachJedemBild) await optionen.nachJedemBild(bild.ref)
    } catch (error) {
      const grund =
        error && typeof error === 'object' && 'statusMessage' in error
          ? String((error as { statusMessage: unknown }).statusMessage)
          : 'Das Bild konnte nicht gespeichert werden.'
      ergebnis.uebersprungen.push({ ref: bild.ref, dateiName: bild.dateiName, grund })
      log.warn('Bild nicht übernommen', { materialId, dateiName: bild.dateiName, error })
    }
  }

  // Varianten erst jetzt verknüpfen – das Hauptbild kann im Plan nach der Variante stehen.
  for (const bild of bilder) {
    if (!bild.varianteVonRef) continue
    const id = idNachRef.get(bild.ref)
    const haupt = idNachRef.get(bild.varianteVonRef)
    if (!id || !haupt || id === haupt) continue
    if (!ergebnis.angelegt.some((a) => a.abbildungId === id)) continue
    await db
      .update(materialAbbildungen)
      .set({ varianteVon: haupt })
      .where(and(eq(materialAbbildungen.id, id), isNull(materialAbbildungen.varianteVon)))
  }

  for (const { abbildungId } of ergebnis.angelegt) queueReindex('abbildung', abbildungId)
  queueReindex('material', materialId)
  return ergebnis
}

// --- Export ------------------------------------------------------------------------

/** `abbildungen.json` einer Sammlung – gleiches Format wie beim Import, damit ein ZIP wieder einspielbar ist. */
export async function abbildungenManifest(materialId: string, db: Database = useDatabase()): Promise<AbbildungManifest & { bilder: Record<string, unknown>[] }> {
  const [material] = await db
    .select({ title: materials.title, description: materials.description, source: materials.source })
    .from(materials)
    .where(eq(materials.id, materialId))
    .limit(1)
  if (!material) throw notFound('Das Material')
  const eintraege = await listAbbildungen(materialId, db)
  const dateiNachId = new Map(eintraege.map((e) => [e.id, e.fileName ?? '']))
  return {
    version: ABBILDUNGEN_MANIFEST_VERSION,
    titel: material.title,
    beschreibung: material.description,
    quelle: material.source,
    bilder: eintraege.map((e) => ({
      datei: e.fileName ?? '',
      titel: e.titel || null,
      beschreibung: e.beschreibung,
      werk: e.werk,
      seite: e.seite,
      abbildung: e.abbildung,
      kapitel: e.kapitel,
      schlagwoerter: e.schlagwoerter,
      beschriftet: e.beschriftet,
      variante_von: e.varianteVon ? (dateiNachId.get(e.varianteVon) ?? null) : null,
      original: e.original,
    })),
  }
}

/** Kopiert die Bildangaben beim Duplizieren eines Materials (Dateien sind dort schon kopiert). */
export async function abbildungenKopieren(
  quelleId: string,
  zielId: string,
  assetZuordnung: ReadonlyMap<string, string>,
  db: Database = useDatabase(),
): Promise<void> {
  const zeilen = await db
    .select()
    .from(materialAbbildungen)
    .where(eq(materialAbbildungen.materialId, quelleId))
    .orderBy(asc(materialAbbildungen.sortOrder))
  if (!zeilen.length) return
  const neueIds = new Map<string, string>()
  for (const zeile of zeilen) {
    const assetId = assetZuordnung.get(zeile.assetId)
    if (!assetId) continue
    const { id, varianteVon: _variante, createdAt: _erstellt, updatedAt: _geaendert, ...rest } = zeile
    const [neu] = await db
      .insert(materialAbbildungen)
      .values({ ...rest, materialId: zielId, assetId })
      .returning({ id: materialAbbildungen.id })
    neueIds.set(id, neu!.id)
  }
  for (const zeile of zeilen) {
    const neu = neueIds.get(zeile.id)
    const haupt = zeile.varianteVon ? neueIds.get(zeile.varianteVon) : undefined
    if (neu && haupt) {
      await db.update(materialAbbildungen).set({ varianteVon: haupt }).where(eq(materialAbbildungen.id, neu))
    }
    if (neu) queueReindex('abbildung', neu)
  }
}

// --- Suche ---------------------------------------------------------------------------

export interface AbbildungSuchtreffer {
  id: string
  titel: string
  beschreibung: string | null
  seite: string | null
  abbildung: string | null
  kapitel: string | null
  werk: string | null
  assetId: string
  fileName: string | null
  mimeType: string | null
  materialId: string
  materialTitle: string
  isArchived: boolean
}

export async function getAbbildungSummaries(ids: string[], db: Database = useDatabase()): Promise<AbbildungSuchtreffer[]> {
  if (!ids.length) return []
  return db
    .select({
      id: materialAbbildungen.id,
      titel: materialAbbildungen.titel,
      beschreibung: materialAbbildungen.beschreibung,
      seite: materialAbbildungen.seite,
      abbildung: materialAbbildungen.abbildung,
      kapitel: materialAbbildungen.kapitel,
      werk: materialAbbildungen.werk,
      assetId: materialAbbildungen.assetId,
      fileName: materialAssets.fileName,
      mimeType: materialAssets.mimeType,
      materialId: materials.id,
      materialTitle: materials.title,
      isArchived: materials.isArchived,
    })
    .from(materialAbbildungen)
    .innerJoin(materialAssets, eq(materialAssets.id, materialAbbildungen.assetId))
    .innerJoin(materials, eq(materials.id, materialAbbildungen.materialId))
    .where(inArray(materialAbbildungen.id, ids))
}

/** Material-ID eines Bildes (für Rechteprüfung und Freigaben). */
export async function abbildungMaterialId(id: string, db: Database = useDatabase()): Promise<string> {
  return (await requireAbbildung(id, db)).materialId
}

/** Zahl der Bilder, die noch keine Angaben aus Paket, KI oder Bearbeitung haben (Hauptbilder). */
export async function abbildungenOhneAngaben(materialId: string, db: Database = useDatabase()): Promise<number> {
  const [zeile] = await queryRows<{ anzahl: number }>(
    db,
    sql`select count(*)::int as anzahl from material_abbildungen
      where material_id = ${materialId}::uuid and herkunft = 'dateiname' and variante_von is null`,
  )
  return zeile?.anzahl ?? 0
}

/** Prüft, ob ein Material eine Abbildungssammlung ist. */
export async function istSammlung(materialId: string, db: Database = useDatabase()): Promise<boolean> {
  const [row] = await db
    .select({ materialType: materials.materialType })
    .from(materials)
    .where(eq(materials.id, materialId))
    .limit(1)
  if (!row) throw notFound('Das Material')
  return row.materialType === 'abbildungssammlung'
}

