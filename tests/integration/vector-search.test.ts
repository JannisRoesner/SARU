import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeConnections, createTestUser, resetDatabase } from './helpers'

const DIMENSIONS = 1536

/** Ordnet Texte festen Richtungen zu, damit die Ähnlichkeiten vorhersagbar sind. */
function fakeVector(text: string): number[] {
  const vector = Array.from({ length: DIMENSIONS }, () => 0)
  if (/query: Essen|Kartoffelsuppe/.test(text)) vector[0] = 1
  else if (/Essensplan/.test(text)) vector[2] = 1
  else vector[1] = 1
  return vector
}

const embeddedInputs: string[] = []

vi.mock('../../server/services/ai/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/services/ai/client')>()
  return {
    ...original,
    createEmbeddings: async (_settings: unknown, inputs: string[]) => {
      embeddedInputs.push(...inputs)
      return inputs.map(fakeVector)
    },
  }
})

const { createMaterial } = await import('../../server/services/material.service')
const { saveAiSettings } = await import('../../server/services/settings.service')
const { waitForIndex, embedPendingDocuments } = await import('../../server/services/search/indexer')
const { search } = await import('../../server/services/search/search.service')

let userId: string

afterAll(async () => {
  await closeConnections()
})

beforeEach(async () => {
  await resetDatabase()
  embeddedInputs.length = 0
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
