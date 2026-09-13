import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { samplePdf } from '../fixtures'
import { closeConnections, createTestUser, resetDatabase, withTempUploadDir } from './helpers'

const { createMaterial } = await import('../../server/services/material.service')
const {
  analyzeBulkPdfUpload,
  commitBulkUpload,
  getBulkRunOverview,
  processBulkPdfUpload,
  startBulkPdfUpload,
  undoBulkUpload,
  updateBulkMapping,
} = await import('../../server/services/bulk-upload/bulk-upload.service')
const { listMaterials, getMaterialDetail } = await import(
  '../../server/repositories/material.repository'
)

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

describe('PDF-Stapel-Upload', () => {
  it('analysiert PDFs und erzeugt eine prüfbare Vorschau', async () => {
    await withTempUploadDir(async () => {
      const result = await analyzeBulkPdfUpload(
        [
          { buffer: pdf, fileName: 'AB_Photosynthese.pdf' },
          { buffer: pdf, fileName: 'Klausur_Kapitel1.pdf' },
        ],
        userId,
        {
          subjectName: 'Biologie',
          gradeLevel: 9,
          defaultMaterialType: 'arbeitsblatt',
        },
      )

      expect(result.fileCount).toBe(2)
      const overview = await getBulkRunOverview(result.runId)
      expect(overview.canCommit).toBe(true)
      expect(overview.files).toHaveLength(2)
      expect(overview.mapping?.subjectName).toBe('Biologie')
      expect(overview.files[0]!.suggestions.title.length).toBeGreaterThan(0)
      expect(overview.files[1]!.suggestions.materialType).toBe('klausur')
    })
  })

  it('legt ausgewählte Materialien mit Datei in einem Schritt an', async () => {
    await withTempUploadDir(async () => {
      const { runId } = await analyzeBulkPdfUpload(
        [{ buffer: pdf, fileName: 'AB_Zellatmung.pdf' }],
        userId,
        { subjectName: 'Biologie', gradeLevel: 10 },
      )

      const overview = await getBulkRunOverview(runId)
      const sourceRef = overview.files[0]!.sourceRef
      await updateBulkMapping(runId, {
        subjectName: 'Biologie',
        gradeLevel: 10,
        records: {
          [sourceRef]: {
            include: true,
            title: 'Arbeitsblatt Zellatmung',
            materialType: 'arbeitsblatt',
            description: 'Kurztest',
            tagNames: ['zellatmung'],
            action: 'erstellen',
          },
        },
      })

      const commit = await commitBulkUpload(runId, userId)
      expect(commit.status).toBe('importiert')
      expect(commit.stats.materialien).toBe(1)
      expect(commit.materialIds).toHaveLength(1)

      const materials = await listMaterials({ pageSize: 20 })
      expect(materials.total).toBe(1)
      expect(materials.items[0]!.title).toBe('Arbeitsblatt Zellatmung')

      const detail = await getMaterialDetail(commit.materialIds[0]!)
      expect(detail?.variants[0]?.assets.length).toBeGreaterThan(0)
      expect(detail?.subjects.some((s) => s.name === 'Biologie')).toBe(true)
    })
  })

  it('kann einen abgeschlossenen Stapel rückgängig machen', async () => {
    await withTempUploadDir(async () => {
      const { runId } = await analyzeBulkPdfUpload(
        [{ buffer: pdf, fileName: 'Notiz.pdf' }],
        userId,
      )
      await commitBulkUpload(runId, userId)
      const undone = await undoBulkUpload(runId)
      expect(undone.removed.materialien).toBe(1)
      const materials = await listMaterials({ pageSize: 20 })
      expect(materials.total).toBe(0)
    })
  })

  it('überspringt abgewählte Dateien beim Commit', async () => {
    await withTempUploadDir(async () => {
      // Zwei unterschiedliche Inhalte, damit keine Checksum-Dublette greift.
      const other = Buffer.concat([pdf, Buffer.from('x')])
      const { runId } = await analyzeBulkPdfUpload(
        [
          { buffer: pdf, fileName: 'eins.pdf' },
          { buffer: other, fileName: 'zwei.pdf' },
        ],
        userId,
      )
      const overview = await getBulkRunOverview(runId)
      const records = Object.fromEntries(
        overview.files.map((f, i) => [
          f.sourceRef,
          {
            include: i === 0,
            title: f.suggestions.title,
            materialType: f.suggestions.materialType,
            action: 'erstellen' as const,
          },
        ]),
      )
      await updateBulkMapping(runId, { records })
      const commit = await commitBulkUpload(runId, userId)
      expect(commit.stats.materialien).toBe(1)
      expect(commit.stats.uebersprungen).toBe(1)
    })
  })

  it('paart Word und PDF und legt eine Musterlösung mit Relation an', async () => {
    await withTempUploadDir(async () => {
      const { zipSync, strToU8 } = await import('fflate')
      const docx = Buffer.from(
        zipSync({
          '[Content_Types].xml': strToU8(
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
          ),
          'word/document.xml': strToU8(
            '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Zellmembran</w:t></w:r></w:p></w:body></w:document>',
          ),
        }),
      )

      const { runId, clusterCount } = await analyzeBulkPdfUpload(
        [
          { buffer: docx, fileName: 'bio_zel_s2_ab_007.docx', relativePath: 'Kopiervorlagen/bio_zel_s2_ab_007.docx' },
          { buffer: pdf, fileName: 'bio_zel_s2_ab_007.pdf', relativePath: 'Kopiervorlagen/bio_zel_s2_ab_007.pdf' },
        ],
        userId,
        { subjectName: 'Biologie' },
      )

      expect(clusterCount).toBe(1)
      const overview = await getBulkRunOverview(runId)
      expect(overview.clusters).toHaveLength(1)
      expect(overview.clusters[0]!.kind).toBe('paar')
      expect(overview.clusters[0]!.suggestions.materialType).toBe('arbeitsblatt')

      const commit = await commitBulkUpload(runId, userId)
      expect(commit.status).toBe('importiert')
      expect(commit.stats.materialien).toBe(2)
      expect(commit.stats.verknuepft).toBe(1)

      const materials = await listMaterials({ pageSize: 20 })
      const types = materials.items.map((m) => m.materialType).sort()
      expect(types).toEqual(['arbeitsblatt', 'musterloesung'])

      const ab = materials.items.find((m) => m.materialType === 'arbeitsblatt')!
      const detail = await getMaterialDetail(ab.id)
      expect(detail?.hasSolution).toBe(true)
      expect(detail?.relations.some((r) => r.relationType === 'musterloesung')).toBe(true)
    })
  })

  it('entpackt ein ZIP und verknüpft Versuch mit Gefährdungsbeurteilung', async () => {
    await withTempUploadDir(async () => {
      const { zipSync, strToU8 } = await import('fflate')
      const docx = Buffer.from(
        zipSync({
          '[Content_Types].xml': strToU8(
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
          ),
          'word/document.xml': strToU8(
            '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Katalase</w:t></w:r></w:p></w:body></w:document>',
          ),
        }),
      )
      const archive = Buffer.from(
        zipSync({
          'Gefährdungsbeurteilung/wd01_049000_gfb_081_katalase.docx': new Uint8Array(docx),
          'Versuche/versuch_katalase.pdf': new Uint8Array(pdf),
        }),
      )

      const { runId, fileCount, clusterCount } = await analyzeBulkPdfUpload(
        [{ buffer: archive, fileName: 'Klett-Dateien.zip' }],
        userId,
      )
      expect(fileCount).toBe(2)
      expect(clusterCount).toBe(2)

      const overview = await getBulkRunOverview(runId)
      const versuch = overview.clusters.find((c) => c.folderRole === 'versuche')!
      const gfb = overview.clusters.find((c) => c.folderRole === 'gefaehrdungsbeurteilung')!
      expect(gfb.suggestions.materialType).toBe('gefaehrdungsbeurteilung')
      expect(versuch.proposedLinks[0]?.targetClusterId).toBe(gfb.clusterId)

      const commit = await commitBulkUpload(runId, userId)
      expect(commit.stats.materialien).toBe(2)
      expect((commit.stats.verknuepft ?? 0) >= 1).toBe(true)

      const materials = await listMaterials({ pageSize: 20 })
      const gfbMaterial = materials.items.find((m) => m.materialType === 'gefaehrdungsbeurteilung')
      expect(gfbMaterial).toBeTruthy()
    })
  })

  it('nimmt Dateien sofort an und erzeugt die Vorschau danach', async () => {
    await withTempUploadDir(async () => {
      const started = await startBulkPdfUpload(
        [{ buffer: pdf, fileName: 'AB_Mitose.pdf' }],
        userId,
      )
      expect(started.status).toBe('laeuft')
      const laufend = await getBulkRunOverview(started.runId)
      expect(laufend.analysisPending).toBe(true)
      expect(laufend.canCommit).toBe(false)

      await processBulkPdfUpload(started.runId)
      const fertig = await getBulkRunOverview(started.runId)
      expect(fertig.analysisPending).toBe(false)
      expect(fertig.canCommit).toBe(true)
      expect(fertig.clusters.length).toBe(1)
    })
  })

  it('ordnet Materialien einem bestehenden Lehrwerk zu', async () => {
    await withTempUploadDir(async () => {
      const lehrwerkId = await createMaterial(
        { title: 'Natura Oberstufe', materialType: 'lehrwerk' },
        userId,
      )
      const { runId } = await analyzeBulkPdfUpload(
        [{ buffer: pdf, fileName: 'AB_Zelle.pdf' }],
        userId,
        { createLehrwerk: true, lehrwerkId },
      )
      const commit = await commitBulkUpload(runId, userId)
      expect(commit.stats.materialien).toBe(1)
      expect(commit.materialIds).not.toContain(lehrwerkId)

      const materials = await listMaterials({ pageSize: 20, filters: { excludeMaterialTypes: ['lehrwerk'] } })
      const detail = await getMaterialDetail(materials.items[0]!.id)
      expect(detail?.relations.some((r) => r.relationType === 'gehoert_zu' && r.material.id === lehrwerkId)).toBe(true)
    })
  })
})
