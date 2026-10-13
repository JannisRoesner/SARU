import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { oeffentlicheFehlermeldung } from '#shared/utils/public-error'
import {
  auswahlUmfang,
  SICHERUNG_ADAPTER_ID,
  SICHERUNG_DATEN,
  SICHERUNG_FORMAT,
  SICHERUNG_VERSION,
  wirdAngelegt,
  type AnalyseEintrag,
  type Dublette,
  type ImportAuswahl,
  type SicherungAnalyse,
} from '#shared/utils/sicherung'
import { useDatabase, type Database } from '../../database/client'
import {
  competencies,
  importLogs,
  importRunItems,
  importRuns,
  learningGroups,
  lessonCompetencies,
  lessonMaterials,
  lessonPhaseMaterials,
  lessonPhases,
  lessons,
  lessonTags,
  materialAssets,
  materialCompetencies,
  materialGradeLevels,
  materialLearningGroups,
  materialRelations,
  materials,
  materialSubjects,
  materialTags,
  materialTopics,
  materialVariants,
  series,
  seriesCompetencies,
  seriesMaterials,
  seriesTags,
  subjects,
  tags,
  topics,
  users,
  type ImportRun,
  type ImportStats,
} from '../../database/schema'
import { appError, notFound } from '../../utils/errors'
import { createLogger } from '../../utils/logger'
import { findAttachmentDuplicates } from '../import/duplicates'
import { undoImport } from '../import/importer'
import { extractAssetText } from '../material.service'
import { queueReindex } from '../search/indexer'
import {
  ALLOWED_TYPES,
  deleteFile,
  extensionOf,
  newStorageKey,
  resolveStoragePath,
  sanitizeFileName,
  storeStagingFile,
} from '../storage.service'
import { queueThumbnailGeneration } from '../thumbnail.service'
import { ARCHIV_PFAD, SICHERUNG_TABELLEN, zeileFuerInsert, type SicherungsDaten, type TabellenName, type Zeile } from './format'
import { ZipLeser, type ZipEintragInfo } from './zip'

const log = createLogger('sicherung:import')

/** Obergrenze für die JSON-Daten – deutlich über jeder realistischen Instanz. */
const MAX_DATEN_BYTES = 480 * 1024 * 1024

/** Beziehungen, über die ein Material weitere Materialien „mitbringt“. */
const MITGEBRACHTE_RELATIONEN = new Set(['musterloesung', 'loesung', 'differenzierung', 'zusatzmaterial'])

// --- Archiv laden -----------------------------------------------------------------

interface GeladeneSicherung {
  leser: ZipLeser
  daten: SicherungsDaten
  /** Ordner, in dem `saru-export.json` liegt (falls neu verpackt). */
  praefix: string
}

async function sicherungLaden(stagingKey: string): Promise<GeladeneSicherung> {
  const leser = await ZipLeser.oeffnen(resolveStoragePath(stagingKey))

  const kandidaten = [...leser.eintraege.values()]
    .filter((e) => e.name === SICHERUNG_DATEN || e.name.endsWith(`/${SICHERUNG_DATEN}`))
    .sort((a, b) => a.name.length - b.name.length)
  const datenEintrag = kandidaten[0]
  if (!datenEintrag) {
    throw appError(
      'IMPORT_FEHLER',
      `Die ZIP-Datei enthält keine „${SICHERUNG_DATEN}“. Bitte eine unveränderte SARU-Sicherung hochladen.`,
    )
  }

  let daten: SicherungsDaten
  try {
    daten = JSON.parse((await leser.puffer(datenEintrag, MAX_DATEN_BYTES)).toString('utf8')) as SicherungsDaten
  } catch (error) {
    if (error instanceof SyntaxError) throw appError('IMPORT_FEHLER', `„${SICHERUNG_DATEN}“ ist beschädigt.`)
    throw error
  }
  if (daten?.format !== SICHERUNG_FORMAT) {
    throw appError('IMPORT_FEHLER', 'Die Datei ist keine SARU-Sicherung.')
  }
  if (typeof daten.version !== 'number' || daten.version > SICHERUNG_VERSION) {
    throw appError(
      'IMPORT_FEHLER',
      'Die Sicherung stammt aus einer neueren SARU-Version. Bitte diese Instanz zuerst aktualisieren.',
    )
  }

  const tabellen = (daten.tabellen ?? {}) as Partial<Record<TabellenName, Zeile[]>>
  for (const name of Object.keys(SICHERUNG_TABELLEN) as TabellenName[]) {
    if (!Array.isArray(tabellen[name])) tabellen[name] = []
  }
  daten.tabellen = tabellen as Record<TabellenName, Zeile[]>
  daten.benutzer = Array.isArray(daten.benutzer) ? daten.benutzer : []

  return { leser, daten, praefix: datenEintrag.name.slice(0, -SICHERUNG_DATEN.length) }
}

// --- Struktur der Sicherung ----------------------------------------------------

const s = (wert: unknown): string => String(wert ?? '')
const sOderNull = (wert: unknown): string | null => (wert == null ? null : String(wert))

function gruppieren(zeilen: Zeile[], schluessel: string): Map<string, Zeile[]> {
  const ergebnis = new Map<string, Zeile[]>()
  for (const zeile of zeilen) {
    const wert = s(zeile[schluessel])
    const liste = ergebnis.get(wert)
    if (liste) liste.push(zeile)
    else ergebnis.set(wert, [zeile])
  }
  return ergebnis
}

/** Nachschlagestrukturen über die Tabellen einer Sicherung. */
class Struktur {
  readonly t: Record<TabellenName, Zeile[]>
  readonly materialien: Map<string, Zeile>
  readonly reihen: Map<string, Zeile>
  readonly stunden: Map<string, Zeile>
  readonly variantenNachMaterial: Map<string, Zeile[]>
  readonly assetsNachVariante: Map<string, Zeile[]>
  readonly phasenNachStunde: Map<string, Zeile[]>
  readonly stundenNachReihe: Map<string, Zeile[]>
  private readonly mitgebracht = new Map<string, string[]>()
  private readonly untergeordnet = new Set<string>()
  private readonly indizes = new Map<string, Map<string, Zeile[]>>()

  constructor(daten: SicherungsDaten) {
    this.t = daten.tabellen
    this.materialien = new Map(this.t.materials.map((m) => [s(m.id), m]))
    this.reihen = new Map(this.t.series.map((r) => [s(r.id), r]))
    this.stunden = new Map(this.t.lessons.map((l) => [s(l.id), l]))
    this.variantenNachMaterial = gruppieren(this.t.materialVariants, 'materialId')
    this.assetsNachVariante = gruppieren(this.t.materialAssets, 'variantId')
    this.phasenNachStunde = gruppieren(this.t.lessonPhases, 'lessonId')
    this.stundenNachReihe = gruppieren(
      [...this.t.lessons].sort((a, b) => Number(a.positionInSeries ?? 0) - Number(b.positionInSeries ?? 0)),
      'seriesId',
    )

    for (const r of this.t.materialRelations) {
      const von = s(r.fromMaterialId)
      const nach = s(r.toMaterialId)
      if (r.relationType === 'gehoert_zu') this.mitbringen(nach, von)
      else if (MITGEBRACHTE_RELATIONEN.has(s(r.relationType))) this.mitbringen(von, nach)
    }
  }

  /** Zeilen einer Tabelle mit `spalte = wert` – einmal gruppiert, dann nachgeschlagen. */
  nach(tabelle: TabellenName, spalte: string, wert: unknown): Zeile[] {
    const schluessel = `${tabelle}.${spalte}`
    let index = this.indizes.get(schluessel)
    if (!index) this.indizes.set(schluessel, (index = gruppieren(this.t[tabelle], spalte)))
    return index.get(s(wert)) ?? []
  }

  private mitbringen(von: string, nach: string) {
    if (von === nach || !this.materialien.has(von) || !this.materialien.has(nach)) return
    this.untergeordnet.add(nach)
    const liste = this.mitgebracht.get(von)
    if (liste) liste.push(nach)
    else this.mitgebracht.set(von, [nach])
  }

  /** Startmaterialien plus alles, was sie (transitiv) mitbringen. */
  huelle(start: Iterable<string>): string[] {
    const ergebnis = new Set<string>()
    const offen = [...start].filter((id) => this.materialien.has(id))
    while (offen.length) {
      const id = offen.pop()!
      if (ergebnis.has(id)) continue
      ergebnis.add(id)
      for (const weiter of this.mitgebracht.get(id) ?? []) if (!ergebnis.has(weiter)) offen.push(weiter)
    }
    return [...ergebnis]
  }

  /** Wird das Material von einem anderen Material mitgebracht (Kind, Lösung …)? */
  istUntergeordnet(id: string): boolean {
    return this.untergeordnet.has(id)
  }

  materialienDerStunde(stundeId: string): string[] {
    const ids = this.nach('lessonMaterials', 'lessonId', stundeId).map((z) => s(z.materialId))
    for (const phase of this.phasenNachStunde.get(stundeId) ?? []) {
      for (const z of this.nach('lessonPhaseMaterials', 'phaseId', phase.id)) ids.push(s(z.materialId))
    }
    return ids
  }

  dateienDesMaterials(materialId: string): Zeile[] {
    return (this.variantenNachMaterial.get(materialId) ?? []).flatMap((v) =>
      (this.assetsNachVariante.get(s(v.id)) ?? []).filter((a) => a.kind === 'datei' && a[ARCHIV_PFAD]),
    )
  }
}

// --- Analyse ----------------------------------------------------------------------

function fachTitel(struktur: Struktur, materialId: string): string | null {
  const namen = struktur
    .nach('materialSubjects', 'materialId', materialId)
    .flatMap((z) => struktur.nach('subjects', 'id', z.subjectId).map((f) => s(f.name)))
  return namen.length ? namen.join(', ') : null
}

function eintraegeBilden(struktur: Struktur): AnalyseEintrag[] {
  const eintraege: AnalyseEintrag[] = []
  const abgedeckt = new Set<string>()
  const merken = (eintrag: AnalyseEintrag) => {
    eintrag.materialIds.forEach((id) => abgedeckt.add(id))
    eintraege.push(eintrag)
  }
  const nachTitel = <T extends Zeile>(a: T, b: T) => s(a.title).localeCompare(s(b.title), 'de')

  for (const m of [...struktur.materialien.values()].filter((m) => m.materialType === 'lehrwerk').sort(nachTitel)) {
    const id = s(m.id)
    const huelle = struktur.huelle([id])
    merken({
      id,
      art: 'lehrwerk',
      titel: s(m.title),
      untertitel: [fachTitel(struktur, id), `${huelle.length - 1} zugeordnete Materialien`].filter(Boolean).join(' · '),
      materialIds: huelle,
      stundenIds: [],
      reihenIds: [],
    })
  }

  for (const r of [...struktur.reihen.values()].sort(nachTitel)) {
    const id = s(r.id)
    const stunden = (struktur.stundenNachReihe.get(id) ?? []).map((l) => s(l.id))
    const start = struktur.nach('seriesMaterials', 'seriesId', id).map((z) => s(z.materialId))
    for (const stunde of stunden) start.push(...struktur.materialienDerStunde(stunde))
    const huelle = struktur.huelle(start)
    merken({
      id,
      art: 'reihe',
      titel: s(r.title),
      untertitel: [sOderNull(r.schoolYear), `${stunden.length} Stunden`, `${huelle.length} Materialien`]
        .filter(Boolean)
        .join(' · '),
      materialIds: huelle,
      stundenIds: stunden,
      reihenIds: [id],
    })
  }

  const ohneReihe = [...struktur.stunden.values()]
    .filter((l) => !l.seriesId || !struktur.reihen.has(s(l.seriesId)))
    .sort((a, b) => s(b.date).localeCompare(s(a.date)) || nachTitel(a, b))
  for (const l of ohneReihe) {
    const id = s(l.id)
    const huelle = struktur.huelle(struktur.materialienDerStunde(id))
    merken({
      id,
      art: 'stunde',
      titel: s(l.title),
      untertitel: [sOderNull(l.date), huelle.length ? `${huelle.length} Materialien` : null].filter(Boolean).join(' · ') || null,
      materialIds: huelle,
      stundenIds: [id],
      reihenIds: [],
    })
  }

  // Lose Materialien: alles, was nicht zu einem Lehrwerk gehört oder Lösung eines anderen ist.
  const lose = [...struktur.materialien.values()]
    .filter((m) => m.materialType !== 'lehrwerk' && !struktur.istUntergeordnet(s(m.id)))
    .sort(nachTitel)
  for (const m of lose) {
    const id = s(m.id)
    const huelle = struktur.huelle([id])
    merken({ id, art: 'material', titel: s(m.title), untertitel: fachTitel(struktur, id), materialIds: huelle, stundenIds: [], reihenIds: [] })
  }

  // Sicherheitsnetz für Zyklen: Jedes Material muss einzeln wählbar bleiben.
  for (const m of struktur.materialien.values()) {
    const id = s(m.id)
    if (abgedeckt.has(id)) continue
    merken({ id, art: 'material', titel: s(m.title), untertitel: fachTitel(struktur, id), materialIds: struktur.huelle([id]), stundenIds: [], reihenIds: [] })
  }

  return eintraege
}

function stueckeln<T>(liste: T[], groesse = 5000): T[][] {
  const teile: T[][] = []
  for (let i = 0; i < liste.length; i += groesse) teile.push(liste.slice(i, i + groesse))
  return teile
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function vorhandeneIds(
  db: Database,
  tabelle: typeof materials | typeof lessons | typeof series,
  ids: string[],
): Promise<Map<string, string>> {
  const ergebnis = new Map<string, string>()
  for (const teil of stueckeln(ids.filter((id) => UUID.test(id)))) {
    const zeilen = await db.select({ id: tabelle.id, title: tabelle.title }).from(tabelle).where(inArray(tabelle.id, teil))
    for (const zeile of zeilen) ergebnis.set(zeile.id, zeile.title)
  }
  return ergebnis
}

const normal = (wert: unknown) => s(wert).trim().toLowerCase()

/**
 * Dublettenprüfung gegen den aktuellen Bestand.
 * - gleiche ID: derselbe Datensatz wurde schon einmal eingespielt.
 * - gleicher Inhalt: alle Dateien liegen bereits vor (Prüfsumme), bzw. bei
 *   Materialien ohne Datei gleicher Titel, Typ und Text; bei Stunden gleiches
 *   Datum und gleicher Titel; bei Reihen gleicher Titel und gleiches Schuljahr.
 */
async function dublettenFinden(struktur: Struktur, db: Database) {
  const materialDubletten = new Map<string, Dublette>()
  const stundenDubletten = new Map<string, Dublette>()
  const reihenDubletten = new Map<string, Dublette>()

  for (const [id, titel] of await vorhandeneIds(db, materials, [...struktur.materialien.keys()])) {
    materialDubletten.set(id, { art: 'gleiche_id', zielId: id, titel })
  }
  for (const [id, titel] of await vorhandeneIds(db, lessons, [...struktur.stunden.keys()])) {
    stundenDubletten.set(id, { art: 'gleiche_id', zielId: id, titel })
  }
  for (const [id, titel] of await vorhandeneIds(db, series, [...struktur.reihen.keys()])) {
    reihenDubletten.set(id, { art: 'gleiche_id', zielId: id, titel })
  }

  // Materialien mit Dateien: alle Prüfsummen bereits vorhanden.
  const offen = [...struktur.materialien.keys()].filter((id) => !materialDubletten.has(id))
  const pruefsummen = new Map<string, string[]>()
  for (const id of offen) {
    const summen = struktur.dateienDesMaterials(id).map((a) => s(a.checksum)).filter(Boolean)
    if (summen.length) pruefsummen.set(id, summen)
  }
  const treffer = new Map<string, { materialId: string; title: string }>()
  for (const teil of stueckeln([...new Set([...pruefsummen.values()].flat())])) {
    for (const [summe, dublette] of await findAttachmentDuplicates(teil, db)) treffer.set(summe, dublette)
  }
  for (const [id, summen] of pruefsummen) {
    if (!summen.every((summe) => treffer.has(summe))) continue
    const ziel = treffer.get(summen[0]!)!
    materialDubletten.set(id, { art: 'gleicher_inhalt', zielId: ziel.materialId, titel: ziel.title })
  }

  // Materialien ohne Dateien (Notizen, Links): Titel, Typ und Text.
  const ohneDateien = offen.filter((id) => !pruefsummen.has(id))
  const titel = [...new Set(ohneDateien.map((id) => normal(struktur.materialien.get(id)!.title)))]
  for (const teil of stueckeln(titel)) {
    const zeilen = await db
      .select({ id: materials.id, title: materials.title, materialType: materials.materialType, content: materials.content })
      .from(materials)
      .where(inArray(sql`lower(trim(${materials.title}))`, teil))
    for (const id of ohneDateien) {
      const m = struktur.materialien.get(id)!
      const gleich = zeilen.find(
        (z) => normal(z.title) === normal(m.title) && z.materialType === m.materialType && s(z.content).trim() === s(m.content).trim(),
      )
      if (gleich) materialDubletten.set(id, { art: 'gleicher_inhalt', zielId: gleich.id, titel: gleich.title })
    }
  }

  // Stunden: gleiches Datum und gleicher Titel.
  const datierte = [...struktur.stunden.values()].filter((l) => l.date && !stundenDubletten.has(s(l.id)))
  for (const teil of stueckeln([...new Set(datierte.map((l) => s(l.date)))])) {
    const zeilen = await db
      .select({ id: lessons.id, title: lessons.title, date: lessons.date })
      .from(lessons)
      .where(inArray(lessons.date, teil))
    for (const l of datierte) {
      const gleich = zeilen.find((z) => z.date === s(l.date) && normal(z.title) === normal(l.title))
      if (gleich) stundenDubletten.set(s(l.id), { art: 'gleicher_inhalt', zielId: gleich.id, titel: gleich.title })
    }
  }

  // Reihen: gleicher Titel und gleiches Schuljahr.
  const reihenOffen = [...struktur.reihen.values()].filter((r) => !reihenDubletten.has(s(r.id)))
  for (const teil of stueckeln([...new Set(reihenOffen.map((r) => normal(r.title)))])) {
    const zeilen = await db
      .select({ id: series.id, title: series.title, schoolYear: series.schoolYear })
      .from(series)
      .where(inArray(sql`lower(trim(${series.title}))`, teil))
    for (const r of reihenOffen) {
      const gleich = zeilen.find((z) => normal(z.title) === normal(r.title) && s(z.schoolYear) === s(r.schoolYear))
      if (gleich) reihenDubletten.set(s(r.id), { art: 'gleicher_inhalt', zielId: gleich.id, titel: gleich.title })
    }
  }

  return { materialDubletten, stundenDubletten, reihenDubletten }
}

async function analysieren(
  geladen: GeladeneSicherung,
  db: Database,
): Promise<Omit<SicherungAnalyse, 'runId' | 'dateiName' | 'dateiGroesse'> & { struktur: Struktur }> {
  const { daten, leser, praefix } = geladen
  const struktur = new Struktur(daten)
  const { materialDubletten, stundenDubletten, reihenDubletten } = await dublettenFinden(struktur, db)

  const warnungen: string[] = []
  let fehlend = 0
  const materialien: SicherungAnalyse['materialien'] = {}
  for (const [id, m] of struktur.materialien) {
    const dateien = struktur.dateienDesMaterials(id)
    for (const datei of dateien) if (!leser.eintraege.has(praefix + s(datei[ARCHIV_PFAD]))) fehlend += 1
    materialien[id] = {
      titel: s(m.title),
      typ: s(m.materialType),
      dateien: dateien.length,
      bytes: dateien.reduce((summe, a) => summe + Number(a.sizeBytes ?? 0), 0),
      dublette: materialDubletten.get(id) ?? null,
    }
  }
  if (fehlend) warnungen.push(`${fehlend} Datei(en) fehlen im Archiv und werden übersprungen.`)

  const stunden: SicherungAnalyse['stunden'] = {}
  for (const [id, l] of struktur.stunden) stunden[id] = { titel: s(l.title), dublette: stundenDubletten.get(id) ?? null }
  const reihen: SicherungAnalyse['reihen'] = {}
  for (const [id, r] of struktur.reihen) reihen[id] = { titel: s(r.title), dublette: reihenDubletten.get(id) ?? null }

  return {
    erstelltAm: sOderNull(daten.erstelltAm),
    exportiertVon: sOderNull(daten.exportiertVon),
    saruVersion: sOderNull(daten.saruVersion),
    warnungen,
    eintraege: eintraegeBilden(struktur),
    materialien,
    stunden,
    reihen,
    struktur,
  }
}

// --- Hochladen und Vorschau -----------------------------------------------------

/** Schreibt den Upload direkt auf die Platte – Sicherungen können viele GB groß sein. */
export async function sicherungEntgegennehmen(quelle: Readable, dateiName: string): Promise<{ stagingKey: string; groesse: number }> {
  const stagingKey = await storeStagingFile(Buffer.alloc(0), dateiName)
  let groesse = 0
  const zaehler = new Transform({
    transform(chunk: Buffer, _enc, weiter) {
      groesse += chunk.length
      weiter(null, chunk)
    },
  })
  try {
    await pipeline(quelle, zaehler, createWriteStream(resolveStoragePath(stagingKey), { mode: 0o640 }))
  } catch (error) {
    await deleteFile(stagingKey)
    throw appError('IMPORT_FEHLER', 'Der Upload wurde abgebrochen.', { cause: error })
  }
  if (groesse === 0) {
    await deleteFile(stagingKey)
    throw appError('UNGUELTIGE_EINGABE', 'Es wurde keine Datei übermittelt.')
  }
  return { stagingKey, groesse }
}

export async function sicherungAnalysieren(
  upload: { stagingKey: string; groesse: number; dateiName: string },
  userId: string,
  db: Database = useDatabase(),
): Promise<SicherungAnalyse> {
  let analyse: Awaited<ReturnType<typeof analysieren>>
  try {
    analyse = await analysieren(await sicherungLaden(upload.stagingKey), db)
  } catch (error) {
    await deleteFile(upload.stagingKey)
    throw error
  }

  // Nur eine offene Vorschau gleichzeitig – ältere, nie gestartete Vorgänge verwerfen.
  const alte = await db
    .select({ id: importRuns.id, stagingPath: importRuns.stagingPath })
    .from(importRuns)
    .where(and(eq(importRuns.adapterId, SICHERUNG_ADAPTER_ID), eq(importRuns.status, 'vorschau')))
  for (const alt of alte) {
    if (alt.stagingPath) await deleteFile(alt.stagingPath)
    await db.delete(importRuns).where(eq(importRuns.id, alt.id))
  }

  const { struktur: _struktur, ...gespeichert } = analyse
  const [run] = await db
    .insert(importRuns)
    .values({
      userId,
      sourceFileName: sanitizeFileName(upload.dateiName),
      sourceSizeBytes: upload.groesse,
      adapterId: SICHERUNG_ADAPTER_ID,
      adapterVersion: String(SICHERUNG_VERSION),
      status: 'vorschau',
      detected: gespeichert as unknown as Record<string, unknown>,
      stagingPath: upload.stagingKey,
    })
    .returning({ id: importRuns.id })

  return { runId: run!.id, dateiName: sanitizeFileName(upload.dateiName), dateiGroesse: upload.groesse, ...gespeichert }
}

// --- Vorgänge ---------------------------------------------------------------------

/** Läufe, die dieser Prozess gerade ausführt – alles andere mit „läuft“ wurde unterbrochen. */
const aktiveLaeufe = new Set<string>()

export interface SicherungLauf {
  analyse: SicherungAnalyse
  status: ImportRun['status']
  stats: ImportStats & { gesamt?: number; erledigt?: number }
  errorMessage: string | null
  startedAt: string
  finishedAt: string | null
  canCommit: boolean
  canUndo: boolean
  logs: Array<{ id: string; level: string; message: string; createdAt: string }>
}

async function laufLaden(runId: string, db: Database): Promise<ImportRun> {
  const [run] = await db.select().from(importRuns).where(eq(importRuns.id, runId)).limit(1)
  if (!run || run.adapterId !== SICHERUNG_ADAPTER_ID) throw notFound('Der Importvorgang')
  return run
}

export async function sicherungLauf(runId: string, db: Database = useDatabase()): Promise<SicherungLauf> {
  let run = await laufLaden(runId, db)

  if (run.status === 'laeuft' && !aktiveLaeufe.has(runId)) {
    // Server wurde während des Imports neu gestartet: Bisheriges bleibt, Rückgängig ist möglich.
    await db
      .update(importRuns)
      .set({ status: 'teilweise_importiert', finishedAt: new Date(), errorMessage: 'Der Import wurde unterbrochen (z. B. durch einen Neustart des Servers).' })
      .where(eq(importRuns.id, runId))
    run = await laufLaden(runId, db)
  }

  const logs = await db
    .select({ id: importLogs.id, level: importLogs.level, message: importLogs.message, createdAt: importLogs.createdAt })
    .from(importLogs)
    .where(eq(importLogs.runId, runId))
    .orderBy(desc(importLogs.createdAt))
    .limit(300)

  return {
    analyse: {
      ...(run.detected as unknown as Omit<SicherungAnalyse, 'runId' | 'dateiName' | 'dateiGroesse'>),
      runId: run.id,
      dateiName: run.sourceFileName,
      dateiGroesse: run.sourceSizeBytes ?? 0,
    },
    status: run.status,
    stats: run.stats,
    errorMessage: run.errorMessage,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    canCommit: run.status === 'vorschau' && Boolean(run.stagingPath),
    canUndo: !run.undoneAt && ['importiert', 'teilweise_importiert'].includes(run.status),
    logs: logs.reverse().map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
  }
}

export async function sicherungLaeufe(db: Database = useDatabase()) {
  return db
    .select({
      id: importRuns.id,
      sourceFileName: importRuns.sourceFileName,
      sourceSizeBytes: importRuns.sourceSizeBytes,
      status: importRuns.status,
      stats: importRuns.stats,
      startedAt: importRuns.startedAt,
      finishedAt: importRuns.finishedAt,
    })
    .from(importRuns)
    .where(eq(importRuns.adapterId, SICHERUNG_ADAPTER_ID))
    .orderBy(desc(importRuns.startedAt))
    .limit(20)
}

export async function sicherungVerwerfen(runId: string, db: Database = useDatabase()): Promise<void> {
  const run = await laufLaden(runId, db)
  if (run.status === 'laeuft') throw appError('KONFLIKT', 'Der Import läuft noch.')
  if (run.status !== 'vorschau') throw appError('KONFLIKT', 'Nur noch nicht gestartete Importe können verworfen werden.')
  if (run.stagingPath) await deleteFile(run.stagingPath)
  await db.delete(importRuns).where(eq(importRuns.id, runId))
}

export async function sicherungRueckgaengig(runId: string, db: Database = useDatabase()) {
  await laufLaden(runId, db)
  return undoImport(runId)
}

/**
 * Startet den Import im Hintergrund. Große Sicherungen brauchen Minuten –
 * die Oberfläche fragt den Fortschritt über `sicherungLauf` ab.
 */
export async function sicherungImportStarten(
  runId: string,
  auswahl: ImportAuswahl,
  userId: string,
  db: Database = useDatabase(),
): Promise<void> {
  const run = await laufLaden(runId, db)
  if (run.status !== 'vorschau' || !run.stagingPath) {
    throw appError('KONFLIKT', 'Dieser Import wurde bereits gestartet oder verworfen.')
  }
  if (!auswahl.eintraege.length) throw appError('UNGUELTIGE_EINGABE', 'Es ist nichts zum Importieren ausgewählt.')

  const [gesperrt] = await db
    .update(importRuns)
    .set({ status: 'laeuft', mapping: { auswahl } as never, stats: {} })
    .where(and(eq(importRuns.id, runId), eq(importRuns.status, 'vorschau')))
    .returning({ id: importRuns.id })
  if (!gesperrt) throw appError('KONFLIKT', 'Dieser Import wurde bereits gestartet.')

  aktiveLaeufe.add(runId)
  void importAusfuehren(runId, run.stagingPath, auswahl, userId, db)
    .catch(async (error: unknown) => {
      log.error('Sicherungsimport fehlgeschlagen', { runId, error })
      await db
        .update(importRuns)
        .set({
          status: 'fehlgeschlagen',
          finishedAt: new Date(),
          errorMessage: oeffentlicheFehlermeldung(error, 'Der Import ist fehlgeschlagen.'),
        })
        .where(eq(importRuns.id, runId))
    })
    .finally(() => aktiveLaeufe.delete(runId))
}

/** Für Tests: Import starten und auf das Ende warten. */
export async function sicherungImportieren(
  runId: string,
  auswahl: ImportAuswahl,
  userId: string,
  db: Database = useDatabase(),
): Promise<SicherungLauf> {
  await sicherungImportStarten(runId, auswahl, userId, db)
  while (aktiveLaeufe.has(runId)) await new Promise((r) => setTimeout(r, 25))
  return sicherungLauf(runId, db)
}

// --- Taxonomie und Besitzer ---------------------------------------------------------

/**
 * Bildet Fächer, Lerngruppen, Themen, Tags und Kompetenzen auf den Bestand ab
 * (über ihre fachlichen Schlüssel) und legt Fehlendes erst bei Bedarf an.
 */
class Taxonomie {
  private readonly cache = new Map<string, Promise<string | null>>()
  private readonly zeilen: Record<'subjects' | 'learningGroups' | 'topics' | 'tags' | 'competencies', Map<string, Zeile>>

  constructor(
    daten: SicherungsDaten,
    private readonly db: Database,
  ) {
    const index = (name: TabellenName) => new Map(daten.tabellen[name].map((z) => [s(z.id), z]))
    this.zeilen = {
      subjects: index('subjects'),
      learningGroups: index('learningGroups'),
      topics: index('topics'),
      tags: index('tags'),
      competencies: index('competencies'),
    }
  }

  private merken(art: string, id: unknown, erzeugen: (zeile: Zeile) => Promise<string | null>, quelle: Map<string, Zeile>) {
    if (id == null) return Promise.resolve(null)
    const schluessel = `${art}:${s(id)}`
    let ergebnis = this.cache.get(schluessel)
    if (!ergebnis) {
      const zeile = quelle.get(s(id))
      ergebnis = zeile ? erzeugen(zeile) : Promise.resolve(null)
      this.cache.set(schluessel, ergebnis)
    }
    return ergebnis
  }

  fach(id: unknown): Promise<string | null> {
    return this.merken('fach', id, async (z) => {
      const [vorhanden] = await this.db.select({ id: subjects.id }).from(subjects).where(eq(subjects.name, s(z.name))).limit(1)
      if (vorhanden) return vorhanden.id
      const [neu] = await this.db
        .insert(subjects)
        .values(zeileFuerInsert(subjects, z, { id: undefined, createdAt: undefined }))
        .onConflictDoNothing()
        .returning({ id: subjects.id })
      if (neu) return neu.id
      const [spaet] = await this.db.select({ id: subjects.id }).from(subjects).where(eq(subjects.name, s(z.name))).limit(1)
      return spaet?.id ?? null
    }, this.zeilen.subjects)
  }

  lerngruppe(id: unknown): Promise<string | null> {
    return this.merken('gruppe', id, async (z) => {
      const jahr = sOderNull(z.schoolYear)
      const bedingung = and(
        eq(learningGroups.name, s(z.name)),
        jahr === null ? isNull(learningGroups.schoolYear) : eq(learningGroups.schoolYear, jahr),
      )
      const [vorhanden] = await this.db.select({ id: learningGroups.id }).from(learningGroups).where(bedingung).limit(1)
      if (vorhanden) return vorhanden.id
      const [neu] = await this.db
        .insert(learningGroups)
        .values(zeileFuerInsert(learningGroups, z, { id: undefined, createdAt: undefined, subjectId: await this.fach(z.subjectId) }))
        .onConflictDoNothing()
        .returning({ id: learningGroups.id })
      return neu?.id ?? (await this.db.select({ id: learningGroups.id }).from(learningGroups).where(bedingung).limit(1))[0]?.id ?? null
    }, this.zeilen.learningGroups)
  }

  thema(id: unknown, tiefe = 0): Promise<string | null> {
    return this.merken('thema', id, async (z) => {
      // Defekte Elternketten (Zyklen) werden nach einigen Ebenen abgeschnitten.
      const eltern = tiefe < 20 ? await this.thema(z.parentId, tiefe + 1) : null
      const bedingung = and(
        eq(topics.name, s(z.name)),
        eltern === null ? isNull(topics.parentId) : eq(topics.parentId, eltern),
      )
      const [vorhanden] = await this.db.select({ id: topics.id }).from(topics).where(bedingung).limit(1)
      if (vorhanden) return vorhanden.id
      const [neu] = await this.db
        .insert(topics)
        .values(zeileFuerInsert(topics, z, { id: undefined, createdAt: undefined, parentId: eltern, subjectId: await this.fach(z.subjectId) }))
        .onConflictDoNothing()
        .returning({ id: topics.id })
      return neu?.id ?? (await this.db.select({ id: topics.id }).from(topics).where(bedingung).limit(1))[0]?.id ?? null
    }, this.zeilen.topics)
  }

  tag(id: unknown): Promise<string | null> {
    return this.merken('tag', id, async (z) => {
      const [neu] = await this.db
        .insert(tags)
        .values(zeileFuerInsert(tags, z, { id: undefined, createdAt: undefined }))
        .onConflictDoNothing()
        .returning({ id: tags.id })
      if (neu) return neu.id
      return (await this.db.select({ id: tags.id }).from(tags).where(eq(tags.name, s(z.name))).limit(1))[0]?.id ?? null
    }, this.zeilen.tags)
  }

  kompetenz(id: unknown): Promise<string | null> {
    return this.merken('kompetenz', id, async (z) => {
      const fach = await this.fach(z.subjectId)
      const bedingung = and(
        eq(competencies.name, s(z.name)),
        fach === null ? isNull(competencies.subjectId) : eq(competencies.subjectId, fach),
      )
      const [vorhanden] = await this.db.select({ id: competencies.id }).from(competencies).where(bedingung).limit(1)
      if (vorhanden) return vorhanden.id
      const [neu] = await this.db
        .insert(competencies)
        .values(zeileFuerInsert(competencies, z, { id: undefined, createdAt: undefined, subjectId: fach }))
        .onConflictDoNothing()
        .returning({ id: competencies.id })
      return neu?.id ?? (await this.db.select({ id: competencies.id }).from(competencies).where(bedingung).limit(1))[0]?.id ?? null
    }, this.zeilen.competencies)
  }
}

async function ids(werte: Array<Promise<string | null>>): Promise<string[]> {
  return [...new Set((await Promise.all(werte)).filter((id): id is string => Boolean(id)))]
}

const ERLAUBTE_MIME = new Set(ALLOWED_TYPES.flatMap((t) => t.mimeTypes))
const ERLAUBTE_ENDUNGEN = new Set(ALLOWED_TYPES.flatMap((t) => t.extensions))

// --- Import ausführen --------------------------------------------------------------

async function importAusfuehren(
  runId: string,
  stagingKey: string,
  auswahl: ImportAuswahl,
  userId: string,
  db: Database,
): Promise<void> {
  const geladen = await sicherungLaden(stagingKey)
  // Dubletten zum Zeitpunkt des Imports neu bestimmen – der Bestand kann sich seit der Vorschau geändert haben.
  const analyse = await analysieren(geladen, db)
  const { struktur } = analyse
  const { daten, leser, praefix } = geladen
  const umfang = auswahlUmfang(analyse, auswahl.eintraege)
  const taxonomie = new Taxonomie(daten, db)

  const besitzerNachEmail = new Map(
    (await db.select({ id: users.id, email: users.email }).from(users)).map((u) => [u.email.toLowerCase(), u.id]),
  )
  const emailNachAlterId = new Map(daten.benutzer.map((b) => [s(b.id), s(b.email).toLowerCase()]))
  const besitzer = (alteId: unknown) => besitzerNachEmail.get(emailNachAlterId.get(s(alteId)) ?? '') ?? userId

  const stats: ImportStats & { gesamt: number; erledigt: number } = {
    materialien: 0,
    stunden: 0,
    reihen: 0,
    dateien: 0,
    uebersprungen: 0,
    fehlgeschlagen: 0,
    gesamt: umfang.materialIds.size + umfang.stundenIds.size + umfang.reihenIds.size,
    erledigt: 0,
  }
  let sequenz = 0
  let letzteMeldung = 0

  const protokoll = (level: 'info' | 'warnung' | 'fehler', message: string) =>
    db.insert(importLogs).values({ runId, level, message })
  const fortschritt = async (erzwingen = false) => {
    if (!erzwingen && Date.now() - letzteMeldung < 1000) return
    letzteMeldung = Date.now()
    await db.update(importRuns).set({ stats: { ...stats } }).where(eq(importRuns.id, runId))
  }
  const angelegt = async (entityType: 'material' | 'series' | 'lesson', entityId: string, titel: string) => {
    sequenz += 1
    await db.insert(importRunItems).values({ runId, sourceRef: `${entityType}:${entityId}`, entityType, entityId, action: 'erstellt', message: titel, sequence: sequenz })
  }
  const fehler = async (art: string, titel: unknown, error: unknown) => {
    stats.fehlgeschlagen = (stats.fehlgeschlagen ?? 0) + 1
    log.warn('Sicherungsimport: Eintrag fehlgeschlagen', { runId, art, error })
    await protokoll('fehler', `${art} „${s(titel)}“: ${oeffentlicheFehlermeldung(error, 'konnte nicht angelegt werden.')}`)
  }

  await protokoll('info', `Import gestartet: ${stats.gesamt} Datensätze ausgewählt.`)
  await fortschritt(true)

  // Alte ID → ID im Bestand (neu angelegt: gleiche ID; Dublette: vorhandener Datensatz).
  const materialZiel = new Map<string, string>()
  const neueMaterialien = new Set<string>()
  const reiheZiel = new Map<string, string>()
  const neueReihen = new Set<string>()

  for (const id of umfang.materialIds) {
    const dublette = analyse.materialien[id]?.dublette
    if (!wirdAngelegt(dublette, auswahl.inhaltsgleicheAnlegen)) materialZiel.set(id, dublette!.zielId)
  }

  // 1. Materialien
  for (const id of umfang.materialIds) {
    if (materialZiel.has(id)) {
      stats.uebersprungen = (stats.uebersprungen ?? 0) + 1
      stats.erledigt += 1
      continue
    }
    const material = struktur.materialien.get(id)!
    const geschrieben: string[] = []
    try {
      const varianten = struktur.variantenNachMaterial.get(id) ?? []
      const dateien = new Map<string, { storageKey: string; mimeType: string | null }>()
      for (const variante of varianten) {
        for (const asset of struktur.assetsNachVariante.get(s(variante.id)) ?? []) {
          if (asset.kind !== 'datei') continue
          const datei = await dateiUebernehmen(leser, praefix, asset)
          if ('warnung' in datei) {
            await protokoll('warnung', `„${s(material.title)}“: ${datei.warnung}`)
            continue
          }
          geschrieben.push(datei.storageKey)
          dateien.set(s(asset.id), datei)
        }
      }

      const zuordnung = (tabelle: TabellenName, spalte: string, abbilden: (wert: unknown) => Promise<string | null>) =>
        ids(struktur.nach(tabelle, 'materialId', id).map((z) => abbilden(z[spalte])))
      const faecher = await zuordnung('materialSubjects', 'subjectId', (x) => taxonomie.fach(x))
      const themen = await zuordnung('materialTopics', 'topicId', (x) => taxonomie.thema(x))
      const schlagworte = await zuordnung('materialTags', 'tagId', (x) => taxonomie.tag(x))
      const kompetenzen = await zuordnung('materialCompetencies', 'competencyId', (x) => taxonomie.kompetenz(x))
      const gruppen = await zuordnung('materialLearningGroups', 'learningGroupId', (x) => taxonomie.lerngruppe(x))
      const stufen = [...new Set(struktur.nach('materialGradeLevels', 'materialId', id).map((z) => s(z.gradeLevel)))]

      const nachzuExtrahieren: string[] = []
      await db.transaction(async (tx) => {
        await tx.insert(materials).values(zeileFuerInsert(materials, material, { ownerId: besitzer(material.ownerId) }))
        for (const variante of varianten) {
          await tx.insert(materialVariants).values(zeileFuerInsert(materialVariants, variante))
          for (const asset of struktur.assetsNachVariante.get(s(variante.id)) ?? []) {
            if (asset.kind === 'datei') {
              const datei = dateien.get(s(asset.id))
              if (!datei) continue
              const offen = asset.extractionStatus === 'ausstehend' || asset.extractionStatus === 'laeuft'
              if (offen) nachzuExtrahieren.push(s(asset.id))
              await tx.insert(materialAssets).values(
                zeileFuerInsert(materialAssets, asset, {
                  storageKey: datei.storageKey,
                  mimeType: datei.mimeType,
                  extractionStatus: offen ? 'ausstehend' : asset.extractionStatus,
                }),
              )
            } else {
              await tx.insert(materialAssets).values(zeileFuerInsert(materialAssets, asset, { storageKey: null }))
            }
          }
        }
        if (faecher.length) await tx.insert(materialSubjects).values(faecher.map((subjectId) => ({ materialId: id, subjectId })))
        if (themen.length) await tx.insert(materialTopics).values(themen.map((topicId) => ({ materialId: id, topicId })))
        if (schlagworte.length) await tx.insert(materialTags).values(schlagworte.map((tagId) => ({ materialId: id, tagId })))
        if (kompetenzen.length) await tx.insert(materialCompetencies).values(kompetenzen.map((competencyId) => ({ materialId: id, competencyId })))
        if (gruppen.length) await tx.insert(materialLearningGroups).values(gruppen.map((learningGroupId) => ({ materialId: id, learningGroupId })))
        if (stufen.length) await tx.insert(materialGradeLevels).values(stufen.map((gradeLevel) => ({ materialId: id, gradeLevel })))
      })

      materialZiel.set(id, id)
      neueMaterialien.add(id)
      stats.materialien = (stats.materialien ?? 0) + 1
      stats.dateien = (stats.dateien ?? 0) + dateien.size
      await angelegt('material', id, s(material.title))

      queueReindex('material', id)
      for (const variante of varianten) {
        for (const asset of struktur.assetsNachVariante.get(s(variante.id)) ?? []) {
          const datei = dateien.get(s(asset.id))
          if (datei) queueThumbnailGeneration(s(asset.id), datei.mimeType, sOderNull(asset.fileName))
        }
      }
      for (const assetId of nachzuExtrahieren) void extractAssetText(assetId, id)
    } catch (error) {
      for (const key of geschrieben) await deleteFile(key)
      await fehler('Material', material.title, error)
    }
    stats.erledigt += 1
    await fortschritt()
  }

  // 2. Beziehungen zwischen Materialien – nur, wenn mindestens eine Seite neu ist.
  for (const r of daten.tabellen.materialRelations) {
    const von = s(r.fromMaterialId)
    const nach = s(r.toMaterialId)
    if (!neueMaterialien.has(von) && !neueMaterialien.has(nach)) continue
    const vonZiel = materialZiel.get(von) ?? (await vorhandenesMaterial(db, von))
    const nachZiel = materialZiel.get(nach) ?? (await vorhandenesMaterial(db, nach))
    if (!vonZiel || !nachZiel || vonZiel === nachZiel) continue
    await db
      .insert(materialRelations)
      .values(zeileFuerInsert(materialRelations, r, { id: undefined, fromMaterialId: vonZiel, toMaterialId: nachZiel }))
      .onConflictDoNothing()
  }

  const variante = async (materialAlt: unknown, varianteAlt: unknown): Promise<string | null> => {
    const alt = s(materialAlt)
    if (!varianteAlt) return null
    if (neueMaterialien.has(alt)) return s(varianteAlt)
    if (materialZiel.get(alt) !== alt) return null
    const [vorhanden] = await db
      .select({ id: materialVariants.id })
      .from(materialVariants)
      .where(and(eq(materialVariants.id, s(varianteAlt)), eq(materialVariants.materialId, alt)))
      .limit(1)
    return vorhanden?.id ?? null
  }
  const materialVerweise = async (zeilen: Zeile[]) => {
    const ergebnis: Array<{ zeile: Zeile; materialId: string; variantId: string | null }> = []
    for (const zeile of zeilen) {
      const materialId = materialZiel.get(s(zeile.materialId))
      if (materialId) ergebnis.push({ zeile, materialId, variantId: await variante(zeile.materialId, zeile.variantId) })
    }
    return ergebnis
  }

  // 3. Reihen
  for (const id of umfang.reihenIds) {
    const reihe = struktur.reihen.get(id)!
    const dublette = analyse.reihen[id]?.dublette
    if (!wirdAngelegt(dublette, auswahl.inhaltsgleicheAnlegen)) {
      reiheZiel.set(id, dublette!.zielId)
      stats.uebersprungen = (stats.uebersprungen ?? 0) + 1
      stats.erledigt += 1
      continue
    }
    try {
      const schlagworte = await ids(struktur.nach('seriesTags', 'seriesId', id).map((z) => taxonomie.tag(z.tagId)))
      const kompetenzen = await ids(struktur.nach('seriesCompetencies', 'seriesId', id).map((z) => taxonomie.kompetenz(z.competencyId)))
      const werte = zeileFuerInsert(series, reihe, {
        subjectId: await taxonomie.fach(reihe.subjectId),
        learningGroupId: await taxonomie.lerngruppe(reihe.learningGroupId),
        topicId: await taxonomie.thema(reihe.topicId),
        ownerId: besitzer(reihe.ownerId),
      })
      const verweise = await materialVerweise(struktur.nach('seriesMaterials', 'seriesId', id))
      await db.transaction(async (tx) => {
        await tx.insert(series).values(werte)
        if (schlagworte.length) await tx.insert(seriesTags).values(schlagworte.map((tagId) => ({ seriesId: id, tagId })))
        if (kompetenzen.length) await tx.insert(seriesCompetencies).values(kompetenzen.map((competencyId) => ({ seriesId: id, competencyId })))
        for (const v of verweise) {
          await tx.insert(seriesMaterials).values(zeileFuerInsert(seriesMaterials, v.zeile, { id: undefined, seriesId: id, materialId: v.materialId, variantId: v.variantId }))
        }
      })
      reiheZiel.set(id, id)
      neueReihen.add(id)
      stats.reihen = (stats.reihen ?? 0) + 1
      await angelegt('series', id, s(reihe.title))
      queueReindex('reihe', id)
    } catch (error) {
      await fehler('Reihe', reihe.title, error)
    }
    stats.erledigt += 1
    await fortschritt()
  }

  // 4. Stunden
  for (const id of umfang.stundenIds) {
    const stunde = struktur.stunden.get(id)!
    if (!wirdAngelegt(analyse.stunden[id]?.dublette, auswahl.inhaltsgleicheAnlegen)) {
      stats.uebersprungen = (stats.uebersprungen ?? 0) + 1
      stats.erledigt += 1
      continue
    }
    try {
      const reiheId = stunde.seriesId ? (reiheZiel.get(s(stunde.seriesId)) ?? (await vorhandeneReihe(db, s(stunde.seriesId)))) : null
      const schlagworte = await ids(struktur.nach('lessonTags', 'lessonId', id).map((z) => taxonomie.tag(z.tagId)))
      const kompetenzen = await ids(struktur.nach('lessonCompetencies', 'lessonId', id).map((z) => taxonomie.kompetenz(z.competencyId)))
      const werte = zeileFuerInsert(lessons, stunde, {
        subjectId: await taxonomie.fach(stunde.subjectId),
        learningGroupId: await taxonomie.lerngruppe(stunde.learningGroupId),
        topicId: await taxonomie.thema(stunde.topicId),
        ownerId: besitzer(stunde.ownerId),
        seriesId: reiheId,
        positionInSeries: reiheId ? stunde.positionInSeries : null,
      })
      const verweise = await materialVerweise(struktur.nach('lessonMaterials', 'lessonId', id))
      const phasen = [...(struktur.phasenNachStunde.get(id) ?? [])].sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
      const phasenVerweise = new Map<string, Awaited<ReturnType<typeof materialVerweise>>>()
      for (const phase of phasen) {
        phasenVerweise.set(s(phase.id), await materialVerweise(struktur.nach('lessonPhaseMaterials', 'phaseId', phase.id)))
      }

      await db.transaction(async (tx) => {
        await tx.insert(lessons).values(werte)
        for (const phase of phasen) {
          const [neu] = await tx
            .insert(lessonPhases)
            .values(zeileFuerInsert(lessonPhases, phase, { id: undefined, lessonId: id }))
            .returning({ id: lessonPhases.id })
          for (const v of phasenVerweise.get(s(phase.id)) ?? []) {
            await tx.insert(lessonPhaseMaterials).values(zeileFuerInsert(lessonPhaseMaterials, v.zeile, { id: undefined, phaseId: neu!.id, materialId: v.materialId, variantId: v.variantId }))
          }
        }
        for (const v of verweise) {
          await tx.insert(lessonMaterials).values(zeileFuerInsert(lessonMaterials, v.zeile, { id: undefined, lessonId: id, materialId: v.materialId, variantId: v.variantId }))
        }
        if (schlagworte.length) await tx.insert(lessonTags).values(schlagworte.map((tagId) => ({ lessonId: id, tagId })))
        if (kompetenzen.length) await tx.insert(lessonCompetencies).values(kompetenzen.map((competencyId) => ({ lessonId: id, competencyId })))
      })
      stats.stunden = (stats.stunden ?? 0) + 1
      await angelegt('lesson', id, s(stunde.title))
      queueReindex('unterrichtsstunde', id)
      if (reiheId && !neueReihen.has(s(stunde.seriesId))) queueReindex('reihe', reiheId)
    } catch (error) {
      await fehler('Stunde', stunde.title, error)
    }
    stats.erledigt += 1
    await fortschritt()
  }

  const status = (stats.fehlgeschlagen ?? 0) > 0 ? 'teilweise_importiert' : 'importiert'
  await protokoll(
    status === 'importiert' ? 'info' : 'warnung',
    `Import abgeschlossen: ${stats.materialien} Materialien (${stats.dateien} Dateien), ${stats.reihen} Reihen, ${stats.stunden} Stunden angelegt; ${stats.uebersprungen} bereits vorhanden, ${stats.fehlgeschlagen} fehlgeschlagen.`,
  )
  await db
    .update(importRuns)
    .set({ status, stats: { ...stats }, finishedAt: new Date(), stagingPath: null })
    .where(eq(importRuns.id, runId))
  await deleteFile(stagingKey)
  log.info('Sicherungsimport abgeschlossen', { runId, stats })
}

async function vorhandenesMaterial(db: Database, id: string): Promise<string | null> {
  if (!UUID.test(id)) return null
  const [zeile] = await db.select({ id: materials.id }).from(materials).where(eq(materials.id, id)).limit(1)
  return zeile?.id ?? null
}

async function vorhandeneReihe(db: Database, id: string): Promise<string | null> {
  if (!UUID.test(id)) return null
  const [zeile] = await db.select({ id: series.id }).from(series).where(eq(series.id, id)).limit(1)
  return zeile?.id ?? null
}

/**
 * Kopiert eine Datei aus dem Archiv in den Speicher – gestreamt, mit Prüfung
 * von Größe und Prüfsumme. Der Archivpfad wird nie als Dateipfad verwendet.
 */
async function dateiUebernehmen(
  leser: ZipLeser,
  praefix: string,
  asset: Zeile,
): Promise<{ storageKey: string; mimeType: string | null } | { warnung: string }> {
  const name = s(asset.fileName) || s(asset[ARCHIV_PFAD])
  if (!asset[ARCHIV_PFAD]) return { warnung: `Datei „${name}“ war schon in der Quelle nicht vorhanden.` }
  const eintrag: ZipEintragInfo | undefined = leser.eintraege.get(praefix + s(asset[ARCHIV_PFAD]))
  if (!eintrag) return { warnung: `Datei „${name}“ fehlt im Archiv.` }

  const endung = extensionOf(s(asset.fileName) || s(asset[ARCHIV_PFAD]))
  if (!ERLAUBTE_ENDUNGEN.has(endung)) return { warnung: `Dateityp „${endung || 'ohne Endung'}“ ist nicht zugelassen („${name}“).` }

  const storageKey = newStorageKey(endung)
  const ziel = resolveStoragePath(storageKey)
  await mkdir(dirname(ziel), { recursive: true })
  const hash = createHash('sha256')
  const pruefen = new Transform({
    transform(chunk: Buffer, _enc, weiter) {
      hash.update(chunk)
      weiter(null, chunk)
    },
  })
  try {
    await pipeline(await leser.stream(eintrag), pruefen, createWriteStream(ziel, { mode: 0o640 }))
  } catch (error) {
    await deleteFile(storageKey)
    throw error
  }
  if (asset.checksum && hash.digest('hex') !== s(asset.checksum)) {
    await deleteFile(storageKey)
    return { warnung: `Datei „${name}“ ist beschädigt (Prüfsumme weicht ab).` }
  }

  const mime = sOderNull(asset.mimeType)
  return { storageKey, mimeType: mime && ERLAUBTE_MIME.has(mime) ? mime : 'application/octet-stream' }
}
