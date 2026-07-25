import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { samplePdf } from '../fixtures'
import { closeConnections, createTestUser, resetDatabase, withTempUploadDir } from './helpers'

const {
  analyzeBulkPdfUpload,
  commitBulkUpload,
  getBulkRunOverview,
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
})
