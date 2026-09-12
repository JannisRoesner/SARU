import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  closeConnections,
  createTestUser,
  resetDatabase,
  withTempUploadDir,
} from './helpers'

const { createMaterial } = await import('../../server/services/material.service')
const { getMaterialDetail } = await import('../../server/repositories/material.repository')
const { publishDifferentiationDraft, enqueueDifferentiation } = await import(
  '../../server/services/ai/differenzierung/service'
)
const { buildWorksheetDocx } = await import('../../server/services/ai/differenzierung/render')
const { storeFile } = await import('../../server/services/storage.service')
const { useDatabase } = await import('../../server/database/client')
const { aiJobs } = await import('../../server/database/schema')
const { saveAiSettings } = await import('../../server/services/settings.service')

let userId: string

beforeAll(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await closeConnections()
})

beforeEach(async () => {
  await resetDatabase()
  userId = (await createTestUser()).id
})

describe('KI-Differenzierung', () => {
  it('legt beim Übernehmen eine Variante an und lässt origin unverändert', async () => {
    await withTempUploadDir(async () => {
      const materialId = await createMaterial(
        { title: 'AB Wasserkreislauf', origin: 'import' },
        userId,
      )
      const before = await getMaterialDetail(materialId)
      expect(before?.origin).toBe('import')

      const buffer = buildWorksheetDocx(
        {
          title: 'Wasserkreislauf in leichter Sprache',
          intro: null,
          tasks: [
            { number: '1', title: null, prompt: 'Was passiert mit dem Wasser?', hints: [], figureNote: null },
          ],
          wordBank: [],
          glossary: [{ term: 'Dampf', explanation: 'Wasser in der Luft.' }],
          uncertainties: 'Abbildung unklar.',
        },
        { profileLabel: 'Leichte Sprache' },
      )
      const stored = await storeFile(buffer, 'Leichte-Sprache-AB.docx')

      const db = useDatabase()
      const [job] = await db
        .insert(aiJobs)
        .values({
          userId,
          materialId,
          kind: 'differenzierung',
          provider: 'ollama',
          model: 'test-modell',
          status: 'pruefung_noetig',
          result: JSON.stringify({
            profile: 'leichte_sprache',
            profileLabel: 'Leichte Sprache',
            sourceVariantId: before!.variants[0]!.id,
            title: 'Wasserkreislauf in leichter Sprache',
            intro: null,
            tasks: [
              { number: '1', title: null, prompt: 'Was passiert mit dem Wasser?', hints: [], figureNote: null },
            ],
            wordBank: [],
            glossary: [{ term: 'Dampf', explanation: 'Wasser in der Luft.' }],
            uncertainties: 'Abbildung unklar.',
            previewMarkdown: '# Test',
            draftStorageKey: stored.storageKey,
            draftFileName: stored.fileName,
            draftMimeType: stored.mimeType,
            model: 'test-modell',
            provider: 'ollama',
          }),
        })
        .returning({ id: aiJobs.id })

      const published = await publishDifferentiationDraft(job!.id, userId)
      const after = await getMaterialDetail(materialId)

      expect(after!.origin).toBe('import')
      expect(after!.variants).toHaveLength(2)
      const kiFassung = after!.variants.find((v) => v.id === published.variantId)
      expect(kiFassung?.label).toBe('Leichte Sprache')
      expect(kiFassung?.variantKind).toBe('differenzierung')
      expect(kiFassung?.differentiationLevel).toBe('grundlegend')
      expect(kiFassung?.aiMeta?.differenzierungProfil).toBe('leichte_sprache')
      expect(kiFassung?.aiMeta?.model).toBe('test-modell')
      expect(kiFassung?.assets.some((a) => a.role === 'haupt' && a.kind === 'datei')).toBe(true)
    })
  })

  it('startet ohne aktivierte KI nicht', async () => {
    const materialId = await createMaterial({ title: 'AB ohne KI' }, userId)
    await expect(
      enqueueDifferentiation(materialId, userId, { profile: 'grundlegend' }),
    ).rejects.toThrow(/nicht aktiviert/i)
  })

  it('lehnt Moodle-Kurse ab', async () => {
    await saveAiSettings({ enabled: true }, userId)
    const materialId = await createMaterial(
      { title: 'Kurs Biologie', materialType: 'moodle_kurs' },
      userId,
    )
    await expect(
      enqueueDifferentiation(materialId, userId, { profile: 'grundlegend' }),
    ).rejects.toThrow(/Materialtyp/i)
  })
})
