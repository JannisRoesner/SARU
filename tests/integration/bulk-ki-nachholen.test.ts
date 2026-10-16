import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { samplePdf } from '../fixtures'
import { closeConnections, createTestUser, resetDatabase, withTempUploadDir } from './helpers'

/** Steuert die KI-Antworten: zuerst wie ein Denkmodell ohne Inhalt, dann vollständig. */
const ki = {
  antwortet: false,
  /** Hält Antworten zurück, solange gesetzt – um den laufenden Vorgang zu prüfen. */
  sperre: null as Promise<void> | null,
}

vi.mock('../../server/services/ai/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/services/ai/client')>()
  return {
    ...original,
    chatCompletion: async (_settings: unknown, messages: { parts: { type: string; text?: string }[] }[]) => {
      if (ki.sperre) await ki.sperre
      if (!ki.antwortet) throw new Error('Das Sprachmodell hat keine Antwort zurückgegeben.')
      const prompt = messages.at(-1)?.parts.map((part) => part.text ?? '').join('\n') ?? ''
      // Der Beispieltext erwähnt Photosynthese – deshalb am Dateinamen „Zellatmung“ unterscheiden.
      const datei = /Zellatmung/.test(prompt) ? 'Zellatmung' : 'Photosynthese'
      return {
        text: JSON.stringify({
          title: `KI-Titel ${datei}`,
          materialType: 'arbeitsblatt',
          schoolForm: 'gymnasium',
          subjectNames: ['Biologie'],
          tagNames: [datei],
          learningObjectives: [`${datei} erklären`],
          description: `KI-Beschreibung ${datei}`,
          contentSummary: `KI-Inhalt ${datei}`,
        }),
        model: 'test-chat',
        finishReason: 'stop',
        outputTokens: 100,
      }
    },
  }
})

const { analyzeBulkPdfUpload, getBulkRunOverview, startKiNachholen, updateBulkMapping, commitBulkUpload } =
  await import('../../server/services/bulk-upload/bulk-upload.service')
const { saveAiSettings } = await import('../../server/services/settings.service')

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
  ki.antwortet = false
  ki.sperre = null
  await saveAiSettings({ enabled: true, provider: 'ollama', chatModel: 'test-chat', useVision: false })
})

async function bisFertig(runId: string) {
  for (let i = 0; i < 200; i += 1) {
    const overview = await getBulkRunOverview(runId)
    if (!overview.kiNachholen) return overview
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Nachholen wurde nicht fertig.')
}

describe('KI-Vorschläge nachholen', () => {
  it('fragt Bündel ohne KI-Vorschlag erneut an und behält eigene Änderungen', async () => {
    await withTempUploadDir(async () => {
      const { runId } = await analyzeBulkPdfUpload(
        [
          { buffer: pdf, fileName: 'AB_Photosynthese.pdf' },
          { buffer: pdf, fileName: 'AB_Zellatmung.pdf' },
        ],
        userId,
        { subjectName: 'Biologie', defaultMaterialType: 'arbeitsblatt' },
      )

      const vorher = await getBulkRunOverview(runId)
      expect(vorher.kiOhneVorschlag).toBe(2)
      expect(vorher.canKiNachholen).toBe(true)

      // Eigener Titel für ein Bündel – der darf nicht überschrieben werden.
      const photo = vorher.clusters.find((cluster) => cluster.stem.includes('Photosynthese'))!
      const zell = vorher.clusters.find((cluster) => cluster.stem.includes('Zellatmung'))!
      const records = { ...vorher.mapping!.records }
      records[photo.clusterId] = { ...records[photo.clusterId]!, title: 'Mein eigener Titel' }
      await updateBulkMapping(runId, { ...vorher.mapping!, records })

      ki.antwortet = true
      let freigeben!: () => void
      ki.sperre = new Promise((resolve) => (freigeben = resolve))
      expect(await startKiNachholen(runId)).toEqual({ gesamt: 2 })

      // Solange es läuft: gesperrt.
      const laufend = await getBulkRunOverview(runId)
      expect(laufend.kiNachholen).toEqual({ fertig: 0, gesamt: 2 })
      expect(laufend.canCommit).toBe(false)
      await expect(updateBulkMapping(runId, laufend.mapping!)).rejects.toThrow(/nachgeholt/)
      await expect(commitBulkUpload(runId, userId)).rejects.toThrow(/nachgeholt/)
      await expect(startKiNachholen(runId)).rejects.toThrow(/bereits/)

      ki.sperre = null
      freigeben()
      const nachher = await bisFertig(runId)

      expect(nachher.kiOhneVorschlag).toBe(0)
      expect(nachher.canKiNachholen).toBe(false)
      expect(nachher.canCommit).toBe(true)
      const photoRecord = nachher.mapping!.records![photo.clusterId]!
      expect(photoRecord.title).toBe('Mein eigener Titel')
      expect(photoRecord.description).toBe('KI-Beschreibung Photosynthese')
      expect(photoRecord.tagNames).toEqual(['Photosynthese'])
      const zellRecord = nachher.mapping!.records![zell.clusterId]!
      expect(zellRecord.title).toBe('KI-Titel Zellatmung')
      expect(zellRecord.content).toBe('KI-Inhalt Zellatmung')
      expect(nachher.clusters.every((cluster) => cluster.suggestions.aiUsed)).toBe(true)
    })
  })

  it('meldet, wenn nichts nachzuholen ist, und nur in der Vorschau', async () => {
    await withTempUploadDir(async () => {
      ki.antwortet = true
      const { runId } = await analyzeBulkPdfUpload(
        [{ buffer: pdf, fileName: 'AB_Photosynthese.pdf' }],
        userId,
        { subjectName: 'Biologie' },
      )
      const overview = await getBulkRunOverview(runId)
      expect(overview.kiOhneVorschlag).toBe(0)
      expect(overview.canKiNachholen).toBe(false)
      expect(await startKiNachholen(runId)).toEqual({ gesamt: 0 })

      await commitBulkUpload(runId, userId)
      await expect(startKiNachholen(runId)).rejects.toThrow(/Vorschau/)
    })
  })
})
