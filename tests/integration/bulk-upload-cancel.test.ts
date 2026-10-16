import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { samplePdf } from '../fixtures'
import { closeConnections, createTestUser, resetDatabase, withTempUploadDir } from './helpers'

/** Hält jede Textextraktion an, bis der Test sie freigibt. */
const sperre = vi.hoisted(() => ({
  aufrufe: 0,
  offen: Promise.resolve(),
  freigeben: () => {},
  ersterAufruf: Promise.resolve(),
  gestartet: () => {},
}))

vi.mock('../../server/services/ai/document-text', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/services/ai/document-text')>()
  return {
    ...original,
    ensureExtractedText: vi.fn(async () => {
      sperre.aufrufe += 1
      sperre.gestartet()
      await sperre.offen
      return { status: 'erfolgreich', text: 'Inhalt des Arbeitsblatts', pageCount: 1, method: 'text_layer' }
    }),
  }
})

const {
  cancelBulkUpload,
  discardBulkUpload,
  getBulkRunOverview,
  processBulkPdfUpload,
  startBulkPdfUpload,
} = await import('../../server/services/bulk-upload/bulk-upload.service')
const { useDatabase } = await import('../../server/database/client')
const { importLogs, importRuns } = await import('../../server/database/schema')

const DATEIEN = 8

let userId: string
let pdf: Buffer

function neueSperre() {
  sperre.aufrufe = 0
  sperre.offen = new Promise((resolve) => (sperre.freigeben = resolve))
  sperre.ersterAufruf = new Promise((resolve) => (sperre.gestartet = resolve))
}

async function stapelStarten() {
  const files = Array.from({ length: DATEIEN }, (_, i) => ({
    buffer: Buffer.concat([pdf, Buffer.from(String(i))]),
    fileName: `AB_Station_${i + 1}.pdf`,
  }))
  return startBulkPdfUpload(files, userId)
}

beforeAll(async () => {
  pdf = await samplePdf()
})

afterAll(async () => {
  await closeConnections()
})

beforeEach(async () => {
  await resetDatabase()
  userId = (await createTestUser()).id
  neueSperre()
})

describe('Stapel-Analyse abbrechen', () => {
  it('hält einen laufenden Worker nach den Dateien in Arbeit an', async () => {
    await withTempUploadDir(async () => {
      const { runId } = await stapelStarten()
      const lauf = processBulkPdfUpload(runId)
      await sperre.ersterAufruf

      await cancelBulkUpload(runId)
      sperre.freigeben()
      await lauf

      // Nur die schon begonnenen Dateien wurden gelesen, nicht der ganze Stapel.
      expect(sperre.aufrufe).toBeGreaterThan(0)
      expect(sperre.aufrufe).toBeLessThan(DATEIEN)

      const overview = await getBulkRunOverview(runId)
      expect(overview.status).toBe('fehlgeschlagen')
      expect(overview.analysisPending).toBe(false)
      expect(overview.errorMessage).toMatch(/abgebrochen/)
      expect(overview.canDiscard).toBe(true)

      const logs = await useDatabase().select().from(importLogs).where(eq(importLogs.runId, runId))
      expect(logs.some((log) => /analysiert/.test(log.message))).toBe(false)
    })
  })

  it('räumt nach dem Verwerfen auch Dateien weg, die der Worker danach noch schreibt', async () => {
    await withTempUploadDir(async () => {
      const { runId } = await stapelStarten()
      const lauf = processBulkPdfUpload(runId)
      await sperre.ersterAufruf

      await discardBulkUpload(runId)
      // Jetzt schreiben die laufenden Extraktionen ihre Textauszüge neben die gelöschten Dateien.
      sperre.freigeben()
      await lauf

      expect(sperre.aufrufe).toBeLessThan(DATEIEN)
      const [row] = await useDatabase().select().from(importRuns).where(eq(importRuns.id, runId))
      expect(row).toBeUndefined()
      const staging = await readdir(join(process.env.NUXT_UPLOAD_DIR!, '.staging'))
      expect(staging).toEqual([])
    })
  })
})
