import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { samplePdf } from '../fixtures'
import { closeConnections, createTestUser, resetDatabase, withTempUploadDir } from './helpers'

const { analyzeBulkPdfUpload, commitBulkUpload, getBulkRunOverview, undoBulkUpload } = await import(
  '../../server/services/bulk-upload/bulk-upload.service'
)
const { listAbbildungen, abbildungAktualisieren, abbildungenManifest } = await import(
  '../../server/services/abbildungen/abbildung.service'
)
const { duplicateMaterial } = await import('../../server/services/material.service')
const { getMaterialDetail, listMaterials } = await import('../../server/repositories/material.repository')
const { search } = await import('../../server/services/search/search.service')
const { waitForIndex } = await import('../../server/services/search/indexer')
const { createShare, freigabeUmfang } = await import('../../server/services/share.service')
const { gastAbbildungen, gastMaterial } = await import('../../server/services/share-view.service')
const { sammleZipEintraege } = await import('../../server/services/material-zip.service')
const { useDatabase } = await import('../../server/database/client')
const { materialAbbildungen, users } = await import('../../server/database/schema')

/** Kleines, echtes PNG – die Upload-Prüfung erkennt den Inhalt am Dateikopf. */
async function png(farbe: string): Promise<Buffer> {
  const { createCanvas } = await import('@napi-rs/canvas')
  const canvas = createCanvas(8, 6)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = farbe
  ctx.fillRect(0, 0, 8, 6)
  return canvas.toBuffer('image/png')
}

const ORDNER = 'Linder Biologie 1/Abbildungen/Cytologie'
const HAUPT = 'S012 Abb 1b - Pflanzenzelle im Lichtmikroskop.png'
const VARIANTE = 'S012 Abb 1b - Pflanzenzelle im Lichtmikroskop - unbeschriftet.png'
const MANIFEST = {
  version: 1,
  titel: 'Linder Biologie 1 – Abbildungen Kapitel Cytologie',
  beschreibung: 'Grafiken aus dem Schülerband',
  quelle: 'Grafik-CD (Schroedel)',
  bilder: [
    {
      datei: HAUPT,
      titel: 'Pflanzenzelle im Lichtmikroskop',
      beschreibung: 'Zellwand, Vakuole und Chloroplasten',
      seite: 12,
      abbildung: '1b',
      kapitel: 'Cytologie',
      schlagwoerter: ['Pflanzenzelle', 'Chloroplast'],
      beschriftet: true,
    },
    { datei: VARIANTE, beschriftet: false, variante_von: HAUPT },
  ],
}

let userId: string
let pdf: Buffer

beforeAll(async () => {
  pdf = await samplePdf()
})

afterAll(async () => {
  await closeConnections()
})

beforeEach(async () => {
  await resetDatabase()
  userId = (await createTestUser()).id
})

async function paket() {
  return [
    { buffer: await png('#0a0'), fileName: HAUPT, relativePath: `${ORDNER}/${HAUPT}` },
    { buffer: await png('#fff'), fileName: VARIANTE, relativePath: `${ORDNER}/${VARIANTE}` },
    { buffer: await png('#00f'), fileName: 'S014 Abb 3 - Tierzelle.png', relativePath: `${ORDNER}/S014 Abb 3 - Tierzelle.png` },
    { buffer: Buffer.from(JSON.stringify(MANIFEST)), fileName: 'abbildungen.json', relativePath: `${ORDNER}/abbildungen.json` },
    { buffer: await png('#f00'), fileName: 'Foto.png', relativePath: 'Linder Biologie 1/Kopiervorlagen/Foto.png' },
    { buffer: pdf, fileName: 'AB6 - Film.pdf', relativePath: 'Linder Biologie 1/Arbeitsblätter/AB6 - Film.pdf' },
    // Kein echtes MP4 nötig: file-type erkennt ftyp-Box und Marke.
    {
      buffer: Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(12)]),
      fileName: 'Film - Mitose.mp4',
      relativePath: 'Linder Biologie 1/Videos/Film - Mitose.mp4',
    },
    {
      buffer: Buffer.from(
        JSON.stringify({ version: 1, videos: [{ datei: 'Film - Mitose.mp4', titel: 'Ablauf der Mitose', bezug: ['Arbeitsblätter/AB6 - Film.pdf'] }] }),
      ),
      fileName: 'videos.json',
      relativePath: 'Linder Biologie 1/Videos/videos.json',
    },
  ]
}

describe('Abbildungssammlung im Stapel', () => {
  it('legt aus einem Abbildungsordner ein Material mit Bildangaben, Varianten, Suche und Freigabe an', async () => {
    await withTempUploadDir(async () => {
      const { runId } = await analyzeBulkPdfUpload(await paket(), userId, {
        createLehrwerk: true,
        lehrwerkTitle: 'Linder Biologie 1',
      })
      const vorschau = await getBulkRunOverview(runId)
      expect(vorschau.status).toBe('vorschau')
      expect(vorschau.skippedFiles.map((s) => s.pfad)).toContain('Linder Biologie 1/Kopiervorlagen/Foto.png')
      const sammlungsBuendel = vorschau.clusters.filter((c) => c.kind === 'abbildungssammlung')
      expect(sammlungsBuendel).toHaveLength(1)
      expect(sammlungsBuendel[0]!.fileRefs).toHaveLength(3)
      const film = vorschau.clusters.find((c) => c.suggestions.materialType === 'video')!
      expect(film.suggestions.title).toBe('Ablauf der Mitose')
      expect(film.proposedLinks[0]).toMatchObject({ relationType: 'bezug', confidence: 'hoch' })

      const ergebnis = await commitBulkUpload(runId, userId)
      expect(ergebnis.status).toBe('importiert')
      expect(ergebnis.stats.abbildungen).toBe(3)

      const sammlungen = await listMaterials({ filters: { materialTypes: ['abbildungssammlung'] }, sort: 'titel', page: 1, pageSize: 10 })
      expect(sammlungen.total).toBe(1)
      const sammlung = sammlungen.items[0]!
      expect(sammlung.title).toBe('Linder Biologie 1 – Abbildungen Kapitel Cytologie')
      expect(sammlung.source).toBe('Grafik-CD (Schroedel)')

      const bilder = await listAbbildungen(sammlung.id)
      expect(bilder).toHaveLength(3)
      const haupt = bilder.find((b) => b.fileName === HAUPT)!
      expect(haupt).toMatchObject({ seite: '12', abbildung: '1b', kapitel: 'Cytologie', beschriftet: true, herkunft: 'paket' })
      expect(bilder.find((b) => b.fileName === VARIANTE)!.varianteVon).toBe(haupt.id)
      expect(bilder.find((b) => b.fileName?.startsWith('S014'))).toMatchObject({ titel: 'Tierzelle', herkunft: 'dateiname' })

      // Video ↔ Arbeitsblatt: an beiden Materialien sichtbar.
      const video = (await listMaterials({ filters: { materialTypes: ['video'] }, sort: 'titel', page: 1, pageSize: 5 })).items[0]!
      const videoDetail = await getMaterialDetail(video.id)
      const blattId = videoDetail!.relations.find((r) => r.relationType === 'bezug')!.material.id
      const blatt = await getMaterialDetail(blattId)
      expect(blatt!.relations.some((r) => r.relationType === 'bezug' && r.direction === 'eingehend' && r.material.id === video.id)).toBe(true)

      // Suche: einzelne Bilder (Hauptbilder, keine Varianten), die Sammlung bleibt ein Material.
      await waitForIndex()
      const bildSuche = await search('Chloroplast', { entityTypes: ['abbildung'] })
      expect(bildSuche.idsByType.abbildung).toEqual([haupt.id])
      const materialSuche = await search('Chloroplast', { entityTypes: ['material'] })
      expect(materialSuche.idsByType.material).toEqual([sammlung.id])

      // Bearbeiten markiert das Bild als von Hand gepflegt und aktualisiert die Suche.
      const tierzelle = bilder.find((b) => b.fileName?.startsWith('S014'))!
      await abbildungAktualisieren(tierzelle.id, { schlagwoerter: ['Mitochondrium'] })
      await waitForIndex()
      expect((await search('Mitochondrium', { entityTypes: ['abbildung'] })).idsByType.abbildung).toEqual([tierzelle.id])
      const [zeile] = await useDatabase().select().from(materialAbbildungen).where(eq(materialAbbildungen.id, tierzelle.id))
      expect(zeile!.herkunft).toBe('bearbeitet')

      // ZIP enthält abbildungen.json im Importformat.
      const zip = await sammleZipEintraege(sammlung.id)
      const json = zip.find((e) => e.name === 'abbildungen.json')!
      const manifest = JSON.parse(json.daten!.toString('utf8'))
      expect(manifest.bilder.find((b: { datei: string }) => b.datei === VARIANTE).variante_von).toBe(HAUPT)
      expect(await abbildungenManifest(sammlung.id)).toMatchObject({ version: 1 })

      // Freigabe der Sammlung: Galerie ohne KI-Felder; ein geteiltes Arbeitsblatt bringt sein Video mit.
      const [u] = await useDatabase().select().from(users).where(eq(users.id, userId))
      const { passwordHash: _ph, ...lehrkraft } = u!
      const link = await createShare({ entityType: 'material', entityId: sammlung.id, permission: 'ansehen' }, lehrkraft)
      const umfang = await freigabeUmfang(link.pfad.split('/').pop()!)
      const gast = await gastAbbildungen(umfang, sammlung.id)
      expect(gast).toHaveLength(3)
      expect(gast[0]).not.toHaveProperty('herkunft')
      expect((await gastMaterial(umfang, sammlung.id)).abbildungAnzahl).toBe(3)
      const blattLink = await createShare({ entityType: 'material', entityId: blattId, permission: 'ansehen' }, lehrkraft)
      const blattUmfang = await freigabeUmfang(blattLink.pfad.split('/').pop()!)
      expect(blattUmfang.materialIds.has(video.id)).toBe(true)

      // Duplizieren übernimmt Bildangaben samt Variante.
      const kopie = await duplicateMaterial(sammlung.id, userId)
      const kopieBilder = await listAbbildungen(kopie)
      expect(kopieBilder).toHaveLength(3)
      expect(kopieBilder.find((b) => b.fileName === VARIANTE)!.varianteVon).toBe(kopieBilder.find((b) => b.fileName === HAUPT)!.id)
    })
  })

  it('ergänzt im zweiten Stapel dieselbe Sammlung im Lehrwerk und macht das Anhängen rückgängig', async () => {
    await withTempUploadDir(async () => {
      const erster = await analyzeBulkPdfUpload((await paket()).slice(0, 4), userId, {
        createLehrwerk: true,
        lehrwerkTitle: 'Linder Biologie 1',
      })
      await commitBulkUpload(erster.runId, userId)
      const lehrwerkId = (await getBulkRunOverview(erster.runId)).mapping!.lehrwerkId!

      const zweiter = await analyzeBulkPdfUpload(
        [
          { buffer: Buffer.from(JSON.stringify(MANIFEST)), fileName: 'abbildungen.json', relativePath: `${ORDNER}/abbildungen.json` },
          { buffer: await png('#0a0'), fileName: HAUPT, relativePath: `${ORDNER}/${HAUPT}` },
          { buffer: await png('#ff0'), fileName: 'S020 Abb 2 - Zellkern.png', relativePath: `${ORDNER}/S020 Abb 2 - Zellkern.png` },
        ],
        userId,
        { createLehrwerk: true, lehrwerkId },
      )
      const ergebnis = await commitBulkUpload(zweiter.runId, userId)
      expect(ergebnis.stats.abbildungen).toBe(1)
      const sammlungen = await listMaterials({ filters: { materialTypes: ['abbildungssammlung'] }, sort: 'titel', page: 1, pageSize: 10 })
      expect(sammlungen.total).toBe(1)
      expect(await listAbbildungen(sammlungen.items[0]!.id)).toHaveLength(4)

      await undoBulkUpload(zweiter.runId)
      const nachUndo = await listAbbildungen(sammlungen.items[0]!.id)
      expect(nachUndo).toHaveLength(3)
      expect(nachUndo.some((b) => b.fileName?.includes('Zellkern'))).toBe(false)
    })
  })
})
