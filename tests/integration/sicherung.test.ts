import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { auswahlZusammenfassen, eintragHatNeues } from '../../shared/utils/sicherung'
import { samplePdf } from '../fixtures'
import { closeConnections, createTestUser, resetDatabase, withTempUploadDir } from './helpers'

const { addFileAsset, addRelation, createMaterial } = await import('../../server/services/material.service')
const { createSeries } = await import('../../server/services/series.service')
const { addPhase, attachMaterial, attachMaterialToPhase, createLesson } = await import('../../server/services/lesson.service')
const { getOrCreateSubject } = await import('../../server/services/taxonomy.service')
const { getMaterialDetail } = await import('../../server/repositories/material.repository')
const { useDatabase } = await import('../../server/database/client')
const schema = await import('../../server/database/schema')
const { resolveStoragePath } = await import('../../server/services/storage.service')
const { sicherungErstellen } = await import('../../server/services/sicherung/export.service')
const { ZipLeser } = await import('../../server/services/sicherung/zip')
const { sicherungAnalysieren, sicherungEntgegennehmen, sicherungImportieren, sicherungRueckgaengig } = await import(
  '../../server/services/sicherung/import.service'
)

const EMAIL = 'lehrkraft@saru.test'

afterAll(async () => {
  await closeConnections()
})

beforeEach(async () => {
  await resetDatabase()
})

interface Quelle {
  lehrwerk: string
  kopiervorlage: string
  loesung: string
  notiz: string
  reihe: string
  stundeInReihe: string
  stundeLose: string
}

/** Baut eine kleine, aber vollständige Instanz auf. */
async function quelleAnlegen(): Promise<Quelle> {
  const { id: userId } = await createTestUser({ email: EMAIL })
  const bio = await getOrCreateSubject('Biologie')

  const lehrwerk = await createMaterial({ title: 'Natura 9', materialType: 'lehrwerk', subjectIds: [bio] }, userId)
  const kopiervorlage = await createMaterial(
    { title: 'Kopiervorlage Fotosynthese', materialType: 'arbeitsblatt', subjectIds: [bio], tagNames: ['Pflanzen'], gradeLevels: [9] },
    userId,
  )
  const loesung = await createMaterial({ title: 'Lösung Fotosynthese', materialType: 'musterloesung' }, userId)
  const notiz = await createMaterial({ title: 'Merkzettel', materialType: 'notiz', content: 'Nicht vergessen' }, userId)

  const varianteVon = async (id: string) => (await getMaterialDetail(id))!.variants[0]!.id
  await addFileAsset(await varianteVon(lehrwerk), { buffer: await samplePdf(), fileName: 'natura9.pdf' }, { preExtracted: { text: 'Buchtext' } })
  await addFileAsset(await varianteVon(kopiervorlage), { buffer: Buffer.from('Kopiervorlage Inhalt'), fileName: 'kv.txt' }, { preExtracted: { text: 'KV' } })
  await addFileAsset(await varianteVon(loesung), { buffer: Buffer.from('Lösung Inhalt'), fileName: 'loesung.txt' }, { preExtracted: { text: 'L' } })
  await addRelation(kopiervorlage, lehrwerk, 'gehoert_zu')
  await addRelation(kopiervorlage, loesung, 'musterloesung')

  const reihe = await createSeries({ title: 'Ökologie', subjectId: bio, schoolYear: '2025/26' }, userId)
  const stundeInReihe = await createLesson({ title: 'Fotosynthese', date: '2025-09-01', seriesId: reihe, subjectId: bio }, userId)
  const phase = await addPhase(stundeInReihe, { name: 'Erarbeitung' })
  await attachMaterialToPhase(phase, { materialId: kopiervorlage })
  const stundeLose = await createLesson({ title: 'Vertretung', date: '2025-10-01' }, userId)
  await attachMaterial(stundeLose, { materialId: notiz })

  return { lehrwerk, kopiervorlage, loesung, notiz, reihe, stundeInReihe, stundeLose }
}

async function exportieren(ziel: string) {
  const { stream, gesammelt } = await sicherungErstellen(EMAIL)
  await pipeline(stream, createWriteStream(ziel))
  return gesammelt
}

async function einlesen(zip: string, userId: string) {
  const upload = await sicherungEntgegennehmen(createReadStream(zip), 'SARU-Sicherung.zip')
  return sicherungAnalysieren({ ...upload, dateiName: 'SARU-Sicherung.zip' }, userId)
}

describe('Sicherung und Wiederherstellung', () => {
  it('exportiert alles, spielt eine Auswahl in eine leere Instanz ein und erkennt Dubletten', async () => {
    const arbeitsordner = await mkdtemp(join(tmpdir(), 'saru-sicherung-'))
    const zip = join(arbeitsordner, 'sicherung.zip')
    try {
      let quelle!: Quelle
      await withTempUploadDir(async () => {
        quelle = await quelleAnlegen()
        const gesammelt = await exportieren(zip)
        expect(gesammelt.fehlend).toEqual([])
        expect(gesammelt.daten.benutzer.map((b) => b.email)).toEqual([EMAIL])
      })

      // Lesbare Ordnerstruktur im Archiv
      const leser = await ZipLeser.oeffnen(zip)
      expect([...leser.eintraege.keys()].sort()).toEqual([
        'LIESMICH.txt',
        'Lehrwerke/Natura 9/Kopiervorlage Fotosynthese/Lösung Fotosynthese/loesung.txt',
        'Lehrwerke/Natura 9/Kopiervorlage Fotosynthese/kv.txt',
        'Lehrwerke/Natura 9/natura9.pdf',
        'saru-export.json',
      ])

      // „Neue Instanz“: leere Datenbank, eigenes Upload-Verzeichnis
      await resetDatabase()
      await withTempUploadDir(async () => {
        const besitzer = await createTestUser({ email: EMAIL })
        const { id: adminId } = await createTestUser({ role: 'admin' })

        const analyse = await einlesen(zip, adminId)
        const arten = Object.fromEntries(analyse.eintraege.map((e) => [e.id, e.art]))
        expect(arten).toEqual({
          [quelle.lehrwerk]: 'lehrwerk',
          [quelle.reihe]: 'reihe',
          [quelle.stundeLose]: 'stunde',
          [quelle.notiz]: 'material',
        })
        const lehrwerkEintrag = analyse.eintraege.find((e) => e.id === quelle.lehrwerk)!
        expect(lehrwerkEintrag.materialIds.sort()).toEqual([quelle.lehrwerk, quelle.kopiervorlage, quelle.loesung].sort())
        expect(Object.values(analyse.materialien).every((m) => m.dublette === null)).toBe(true)

        // Lose Notiz (und damit die Vertretungsstunde) bewusst abwählen.
        const auswahl = { eintraege: [quelle.lehrwerk, quelle.reihe], inhaltsgleicheAnlegen: false }
        expect(auswahlZusammenfassen(analyse, auswahl)).toMatchObject({ materialien: 3, dateien: 3, reihen: 1, stunden: 1, vorhanden: 0 })

        const lauf = await sicherungImportieren(analyse.runId, auswahl, adminId)
        expect(lauf.status).toBe('importiert')
        expect(lauf.stats).toMatchObject({ materialien: 3, dateien: 3, reihen: 1, stunden: 1, fehlgeschlagen: 0 })

        const db = useDatabase()
        const lehrwerk = await getMaterialDetail(quelle.lehrwerk)
        expect(lehrwerk?.title).toBe('Natura 9')
        expect(lehrwerk?.ownerId).toBe(besitzer.id)
        expect(lehrwerk?.subjects.map((s) => s.name)).toEqual(['Biologie'])
        const asset = lehrwerk!.variants[0]!.assets[0]!
        const [gespeichert] = await db.select().from(schema.materialAssets).where(eq(schema.materialAssets.id, asset.id))
        const inhalt = await readFile(resolveStoragePath(gespeichert!.storageKey!))
        expect(inhalt.equals(await samplePdf())).toBe(true)
        expect(gespeichert!.checksum).toBe(createHash('sha256').update(inhalt).digest('hex'))
        expect(gespeichert!.extractedText).toBe('Buchtext')

        const kv = await getMaterialDetail(quelle.kopiervorlage)
        expect(kv?.tags.map((t) => t.name)).toEqual(['Pflanzen'])
        expect(kv?.gradeLevels).toEqual([9])
        const relationen = await db.select().from(schema.materialRelations)
        expect(relationen.map((r) => r.relationType).sort()).toEqual(['gehoert_zu', 'musterloesung'])

        const [stunde] = await db.select().from(schema.lessons).where(eq(schema.lessons.id, quelle.stundeInReihe))
        expect(stunde?.seriesId).toBe(quelle.reihe)
        const phasenMaterial = await db.select().from(schema.lessonPhaseMaterials)
        expect(phasenMaterial.map((p) => p.materialId)).toEqual([quelle.kopiervorlage])
        expect(await getMaterialDetail(quelle.notiz)).toBeNull()

        // Dieselbe Sicherung erneut: Bereits Eingespieltes wird erkannt.
        const zweite = await einlesen(zip, adminId)
        expect(zweite.materialien[quelle.lehrwerk]?.dublette?.art).toBe('gleiche_id')
        expect(zweite.stunden[quelle.stundeInReihe]?.dublette?.art).toBe('gleiche_id')
        const nachId = new Map(zweite.eintraege.map((e) => [e.id, e]))
        expect(eintragHatNeues(zweite, nachId.get(quelle.lehrwerk)!)).toBe(false)
        expect(eintragHatNeues(zweite, nachId.get(quelle.reihe)!)).toBe(false)
        expect(eintragHatNeues(zweite, nachId.get(quelle.stundeLose)!)).toBe(true)

        const nachtrag = await sicherungImportieren(
          zweite.runId,
          { eintraege: [quelle.stundeLose, quelle.lehrwerk], inhaltsgleicheAnlegen: false },
          adminId,
        )
        expect(nachtrag.stats).toMatchObject({ materialien: 1, stunden: 1, uebersprungen: 3, fehlgeschlagen: 0 })
        expect((await db.select().from(schema.lessonMaterials)).map((l) => l.materialId)).toEqual([quelle.notiz])

        // Erster Import zurück: Nur dessen Datensätze verschwinden – samt Dateien.
        await sicherungRueckgaengig(lauf.analyse.runId)
        expect(await getMaterialDetail(quelle.lehrwerk)).toBeNull()
        expect(await db.select().from(schema.series)).toHaveLength(0)
        expect((await db.select().from(schema.lessons)).map((l) => l.id)).toEqual([quelle.stundeLose])
        expect(await getMaterialDetail(quelle.notiz)).not.toBeNull()
        await expect(readFile(resolveStoragePath(gespeichert!.storageKey!))).rejects.toThrow()

        // Gleiche Datei unter anderer Kennung → inhaltsgleich statt neu.
        const fremd = await createMaterial({ title: 'Mein Natura', materialType: 'lehrwerk' }, adminId)
        const fremdVariante = (await getMaterialDetail(fremd))!.variants[0]!.id
        await addFileAsset(fremdVariante, { buffer: await samplePdf(), fileName: 'anders.pdf' }, { preExtracted: { text: 'x' } })
        const dritte = await einlesen(zip, adminId)
        expect(dritte.materialien[quelle.lehrwerk]?.dublette).toMatchObject({ art: 'gleicher_inhalt', zielId: fremd })

        const verknuepft = await sicherungImportieren(
          dritte.runId,
          { eintraege: [quelle.lehrwerk], inhaltsgleicheAnlegen: false },
          adminId,
        )
        expect(verknuepft.stats).toMatchObject({ materialien: 2, uebersprungen: 1 })
        const zuordnung = await db
          .select()
          .from(schema.materialRelations)
          .where(eq(schema.materialRelations.relationType, 'gehoert_zu'))
        expect(zuordnung.map((r) => [r.fromMaterialId, r.toMaterialId])).toEqual([[quelle.kopiervorlage, fremd]])
      })
    } finally {
      await rm(arbeitsordner, { recursive: true, force: true })
    }
  })

  it('lehnt fremde ZIP-Dateien verständlich ab', async () => {
    await withTempUploadDir(async () => {
      const { id } = await createTestUser({ role: 'admin' })
      const ordner = await mkdtemp(join(tmpdir(), 'saru-fremd-'))
      try {
        const { zipSchreiben } = await import('../../server/services/sicherung/zip')
        const pfad = join(ordner, 'fremd.zip')
        await pipeline(zipSchreiben([{ name: 'irgendwas.txt', daten: Buffer.from('hallo') }]), createWriteStream(pfad))
        await expect(einlesen(pfad, id)).rejects.toThrow(/saru-export\.json/)
        expect(await useDatabase().select().from(schema.importRuns)).toHaveLength(0)
      } finally {
        await rm(ordner, { recursive: true, force: true })
      }
    })
  })
})
