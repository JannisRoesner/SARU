import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq, isNotNull } from 'drizzle-orm'
import { samplePdf } from '../fixtures'
import { closeConnections, createTestUser, resetDatabase, withTempUploadDir } from './helpers'

const DIMENSIONS = 1536

/**
 * Ordnet Texte festen Richtungen zu, damit die Ähnlichkeiten vorhersagbar sind.
 * Seitenbilder zeigen in dieselbe Richtung wie die Anfrage „Essen“.
 */
function fakeVector(input: string | { type: 'image' }): number[] {
  const vector = Array.from({ length: DIMENSIONS }, () => 0)
  const text = typeof input === 'string' ? input : ''
  if (typeof input !== 'string' || /query: Essen|Kartoffelsuppe/.test(text)) vector[0] = 1
  else if (/Essensplan/.test(text)) vector[2] = 1
  else vector[1] = 1
  return vector
}

const embeddedInputs: string[] = []
let embeddedImages = 0

vi.mock('../../server/services/ai/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/services/ai/client')>()
  return {
    ...original,
    createEmbeddings: async (_settings: unknown, inputs: (string | { type: 'image' })[]) => {
      for (const input of inputs) {
        if (typeof input === 'string') embeddedInputs.push(input)
        else embeddedImages += 1
      }
      return inputs.map(fakeVector)
    },
  }
})

const { addFileAsset, createMaterial } = await import('../../server/services/material.service')
const { getMaterialDetail } = await import('../../server/repositories/material.repository')
const { useDatabase } = await import('../../server/database/client')
const { searchDocuments } = await import('../../server/database/schema')
const { saveAiSettings } = await import('../../server/services/settings.service')
const { waitForIndex, embedPendingDocuments, getIndexStatus } = await import(
  '../../server/services/search/indexer'
)
const { search } = await import('../../server/services/search/search.service')

let userId: string

afterAll(async () => {
  await closeConnections()
})

beforeEach(async () => {
  await resetDatabase()
  embeddedInputs.length = 0
  embeddedImages = 0
  userId = (await createTestUser()).id
})

async function prepare(vectorOnlySearch: boolean) {
  await saveAiSettings({
    enabled: true,
    chatModel: 'test-chat',
    embeddingsEnabled: true,
    embeddingModel: 'embeddinggemma',
    vectorOnlySearch,
  })
  await createMaterial({ title: 'Essensplan für die Klassenfahrt' }, userId)
  await createMaterial({ title: 'Kartoffelsuppe kochen' }, userId)
  for (const title of ['Zellteilung', 'Fotosynthese', 'Bruchrechnung', 'Gedichtanalyse']) {
    await createMaterial({ title }, userId)
  }
  await waitForIndex()
  while ((await embedPendingDocuments(64)) > 0) {
    // Alle Abschnitte mit Vektoren versehen.
  }
}

describe('Vektorsuche', () => {
  it('nutzt die EmbeddingGemma-Präfixe für Dokumente und Anfragen', async () => {
    await prepare(false)
    await search('Essen')

    expect(embeddedInputs).toContain('task: search result | query: Essen')
    expect(embeddedInputs.some((input) => input.startsWith('title: Kartoffelsuppe kochen | text: '))).toBe(true)
  })

  it('stellt starke Vektortreffer vor bloße Wortübereinstimmungen', async () => {
    await prepare(false)
    const result = await search('Essen')

    expect(result.vectorSearchUsed).toBe(true)
    expect(result.hits[0]!.title).toBe('Kartoffelsuppe kochen')
    expect(result.hits.map((hit) => hit.title)).toContain('Essensplan für die Klassenfahrt')
  })

  it('sucht im reinen Vektormodus ohne Volltext', async () => {
    await prepare(true)
    const result = await search('Essen')

    expect(result.hits[0]!.title).toBe('Kartoffelsuppe kochen')
    // Die Wortübereinstimmung zählt nicht mehr – der Essensplan landet bei den übrigen Treffern.
    const essensplan = result.hits.find((hit) => hit.title === 'Essensplan für die Klassenfahrt')
    expect(essensplan?.matchedIn).not.toContain('titel')
  })

  it('fällt im reinen Vektormodus ohne Anfragevektor auf die Volltextsuche zurück', async () => {
    await prepare(true)
    const result = await search('Essensplan', { skipVector: true })

    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]!.title).toBe('Essensplan für die Klassenfahrt')
  })
})

describe('Seitenbilder in der Vektorsuche', () => {
  async function materialMitPdf(embedImages: boolean, provider: 'openai_kompatibel' | 'ollama') {
    await saveAiSettings({
      enabled: true,
      provider,
      chatModel: 'test-chat',
      embeddingsEnabled: true,
      embeddingModel: 'embeddinggemma-2',
      vectorOnlySearch: true,
      embedImages,
    })
    // Der Titel und der PDF-Text haben mit der Anfrage nichts zu tun – nur das Seitenbild passt.
    const id = await createMaterial({ title: 'Unbenanntes Blatt' }, userId)
    for (const title of ['Zellteilung', 'Bruchrechnung', 'Gedichtanalyse']) {
      await createMaterial({ title }, userId)
    }
    const detail = await getMaterialDetail(id)
    await addFileAsset(detail!.variants[0]!.id, { buffer: await samplePdf(), fileName: 'sample.pdf' })

    // Textextraktion läuft im Hintergrund und reiht das Material danach erneut ein.
    await new Promise((resolve) => setTimeout(resolve, 3000))
    await waitForIndex()
    while ((await embedPendingDocuments(64)) > 0) {
      // Alle Abschnitte und Seitenbilder mit Vektoren versehen.
    }
    return id
  }

  it('findet Materialien über ihre Seitenbilder', async () => {
    await withTempUploadDir(async () => {
      const id = await materialMitPdf(true, 'openai_kompatibel')

      expect(embeddedImages).toBeGreaterThan(0)
      const status = await getIndexStatus()
      expect(status.images).toBeGreaterThan(0)
      expect(status.imagesEmbedded).toBe(status.images)
      expect(status.pending).toBe(0)

      const result = await search('Essen')
      expect(result.hits[0]!.entityId).toBe(id)
      expect(result.hits[0]!.matchedIn).toContain('bild')
      expect(result.hits[0]!.sourceLabel).toMatch(/^sample\.pdf/)
      expect(result.hits[0]!.snippet).toBeNull()
    })
  }, 30_000)

  it('legt keine Seitenbilder an, wenn der Anbieter nur Text einbettet', async () => {
    await withTempUploadDir(async () => {
      const id = await materialMitPdf(true, 'ollama')

      expect(embeddedImages).toBe(0)
      // Nur dieses Material prüfen: Ein Hintergrundlauf des vorigen Tests kann nach dem
      // Zurücksetzen der Datenbank noch Abschnitte eines gelöschten Materials schreiben.
      const bilder = await useDatabase()
        .select({ id: searchDocuments.id })
        .from(searchDocuments)
        .where(and(eq(searchDocuments.entityId, id), isNotNull(searchDocuments.imageSource)))
      expect(bilder).toHaveLength(0)
    })
  }, 30_000)
})
