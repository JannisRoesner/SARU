import { stat } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import { asc, inArray, sql } from 'drizzle-orm'
import { SICHERUNG_DATEN, SICHERUNG_FORMAT, SICHERUNG_VERSION } from '#shared/utils/sicherung'
import { useDatabase, type Database } from '../../database/client'
import { users } from '../../database/schema'
import { createLogger } from '../../utils/logger'
import { formatBytes, resolveStoragePath } from '../storage.service'
import { ARCHIV_PFAD, SICHERUNG_TABELLEN, type SicherungsDaten, type TabellenName, type Zeile } from './format'
import { dateiPfade, materialOrdner } from './pfade'
import { zipSchreiben, type ZipQuelle } from './zip'

const log = createLogger('sicherung:export')

export interface SicherungUebersicht {
  materialien: number
  lehrwerke: number
  reihen: number
  stunden: number
  dateien: number
  bytes: number
}

/** Schnelle Zahlen für die Einstellungsseite – ohne Dateien anzufassen. */
export async function sicherungUebersicht(db: Database = useDatabase()): Promise<SicherungUebersicht> {
  const [zeilen] = (await db.execute<{
    materialien: number
    lehrwerke: number
    reihen: number
    stunden: number
    dateien: number
    bytes: number
  }>(
    // Zählt bewusst über SQL, damit große Instanzen nicht alles laden müssen.
    sql`select
      (select count(*)::int from materials) as materialien,
      (select count(*)::int from materials where material_type = 'lehrwerk') as lehrwerke,
      (select count(*)::int from series) as reihen,
      (select count(*)::int from lessons) as stunden,
      (select count(*)::int from material_assets where kind = 'datei' and storage_key is not null) as dateien,
      (select coalesce(sum(size_bytes), 0)::float8 from material_assets where kind = 'datei' and storage_key is not null) as bytes`,
  )) as unknown as SicherungUebersicht[]
  return zeilen!
}

export interface GesammelteSicherung {
  daten: SicherungsDaten
  dateien: Array<{ name: string; datei: string; groesse: number }>
  fehlend: string[]
}

/** Liest alle Inhalte und ermittelt Archivpfade für vorhandene Dateien. */
export async function sicherungSammeln(
  exportiertVon: string | null,
  db: Database = useDatabase(),
): Promise<GesammelteSicherung> {
  const tabellen = {} as Record<TabellenName, Zeile[]>
  for (const [name, tabelle] of Object.entries(SICHERUNG_TABELLEN) as [TabellenName, (typeof SICHERUNG_TABELLEN)[TabellenName]][]) {
    tabellen[name] = (await db.select().from(tabelle)) as Zeile[]
  }

  // Erstes Fach je Material in der Sortierung der Fächerliste.
  const faecher = new Map(
    [...tabellen.subjects]
      .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder) || String(a.name).localeCompare(String(b.name), 'de'))
      .map((f, rang) => [f.id as string, { name: f.name as string, rang }]),
  )
  const erstesFach = new Map<string, { name: string; rang: number }>()
  for (const zuordnung of tabellen.materialSubjects) {
    const fach = faecher.get(zuordnung.subjectId as string)
    const materialId = zuordnung.materialId as string
    if (fach && fach.rang < (erstesFach.get(materialId)?.rang ?? Infinity)) erstesFach.set(materialId, fach)
  }
  const fachName = new Map([...erstesFach].map(([id, fach]) => [id, fach.name]))

  const ordner = materialOrdner(
    tabellen.materials as never,
    tabellen.materialRelations as never,
    fachName,
  )
  const pfade = dateiPfade(
    ordner,
    tabellen.materialVariants as never,
    (tabellen.materialAssets as Zeile[]).filter((a) => a.kind === 'datei' && a.storageKey) as never,
  )

  const dateien: GesammelteSicherung['dateien'] = []
  const fehlend: string[] = []
  tabellen.materialAssets = await Promise.all(
    tabellen.materialAssets.map(async (asset) => {
      const { storageKey, ...rest } = asset
      const pfad = pfade.get(asset.id as string)
      if (!storageKey || !pfad) return { ...rest, [ARCHIV_PFAD]: null }
      try {
        const datei = resolveStoragePath(storageKey as string)
        const info = await stat(datei)
        if (!info.isFile()) throw new Error('keine Datei')
        dateien.push({ name: pfad, datei, groesse: info.size })
        return { ...rest, [ARCHIV_PFAD]: pfad }
      } catch {
        fehlend.push(String(asset.fileName ?? asset.id))
        return { ...rest, [ARCHIV_PFAD]: null }
      }
    }),
  )
  dateien.sort((a, b) => a.name.localeCompare(b.name, 'de'))

  const besitzerIds = new Set<string>()
  for (const name of ['materials', 'series', 'lessons'] as const) {
    for (const zeile of tabellen[name]) if (zeile.ownerId) besitzerIds.add(zeile.ownerId as string)
  }
  const benutzer = besitzerIds.size
    ? await db
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(inArray(users.id, [...besitzerIds]))
        .orderBy(asc(users.email))
    : []

  return {
    daten: {
      format: SICHERUNG_FORMAT,
      version: SICHERUNG_VERSION,
      erstelltAm: new Date().toISOString(),
      saruVersion: process.env.npm_package_version ?? null,
      exportiertVon,
      benutzer,
      tabellen,
    },
    dateien,
    fehlend,
  }
}

function liesMich(gesammelt: GesammelteSicherung): string {
  const t = gesammelt.daten.tabellen
  const bytes = gesammelt.dateien.reduce((summe, d) => summe + d.groesse, 0)
  const zeilen = [
    'SARU – Sicherung',
    '================',
    '',
    `Erstellt am: ${new Date(gesammelt.daten.erstelltAm).toLocaleString('de-DE')}`,
    gesammelt.daten.exportiertVon ? `Erstellt von: ${gesammelt.daten.exportiertVon}` : null,
    '',
    `Materialien: ${t.materials.length} (davon Lehrwerke: ${t.materials.filter((m) => m.materialType === 'lehrwerk').length})`,
    `Reihen: ${t.series.length}`,
    `Stunden: ${t.lessons.length}`,
    `Dateien: ${gesammelt.dateien.length} (${formatBytes(bytes)})`,
    '',
    'Wiederherstellen',
    '----------------',
    'In einer SARU-Instanz unter Einstellungen → Sicherung & Umzug diese ZIP-Datei',
    'unverändert hochladen. Vor dem Import lassen sich einzelne Lehrwerke, Reihen,',
    'Stunden und Materialien abwählen; bereits vorhandene Inhalte werden erkannt.',
    '',
    'Aufbau',
    '------',
    `${SICHERUNG_DATEN}   Alle Daten (Metadaten, Varianten, Stunden, Reihen, Zuordnungen)`,
    'Lehrwerke/          Lehrwerke mit ihren zugeordneten Materialien',
    'Materialien/<Fach>/ Alle übrigen Materialien, nach Fach geordnet',
    '',
    'Die Ordner dienen dem Durchsehen. Für die Wiederherstellung ist allein',
    `${SICHERUNG_DATEN} maßgeblich – Dateien bitte nicht umbenennen oder verschieben.`,
    '',
    'Nicht enthalten: Benutzerkonten, Einstellungen und API-Schlüssel,',
    'Freigabe-Links, KI-Protokolle und der Suchindex.',
  ]
  if (gesammelt.fehlend.length) {
    zeilen.push('', `Achtung: ${gesammelt.fehlend.length} Datei(en) fehlten bereits auf dem Server:`)
    for (const name of gesammelt.fehlend.slice(0, 200)) zeilen.push(`  - ${name}`)
  }
  return zeilen.filter((z) => z !== null).join('\r\n') + '\r\n'
}

/** Erzeugt die vollständige Sicherung als ZIP-Stream. */
export async function sicherungErstellen(
  exportiertVon: string | null,
  db: Database = useDatabase(),
): Promise<{ stream: Readable; gesammelt: GesammelteSicherung }> {
  const gesammelt = await sicherungSammeln(exportiertVon, db)
  log.info('Sicherung wird erstellt', {
    materialien: gesammelt.daten.tabellen.materials.length,
    dateien: gesammelt.dateien.length,
    fehlend: gesammelt.fehlend.length,
  })

  function* quellen(): Generator<ZipQuelle> {
    yield { name: 'LIESMICH.txt', daten: Buffer.from(liesMich(gesammelt), 'utf8') }
    yield { name: SICHERUNG_DATEN, daten: Buffer.from(JSON.stringify(gesammelt.daten), 'utf8') }
    yield* gesammelt.dateien
  }

  return { stream: zipSchreiben(quellen()), gesammelt }
}
