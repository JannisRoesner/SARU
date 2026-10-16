import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeConnections, createTestUser, resetDatabase } from './helpers'

vi.mock('../../server/services/ai/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/services/ai/client')>()
  return {
    ...original,
    createEmbeddings: async (_settings: unknown, inputs: unknown[]) =>
      inputs.map(() => Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0))),
  }
})

const { useDatabase } = await import('../../server/database/client')
const { appSettings } = await import('../../server/database/schema')
const { encryptSecret } = await import('../../server/utils/crypto')
const { createMaterial } = await import('../../server/services/material.service')
const {
  aiVerbindung,
  getAiSettings,
  saveAiSettings,
  SETTING_KEYS,
} = await import('../../server/services/settings.service')
const {
  embedPendingDocuments,
  embeddingsNachAnbieterwechselVerwerfen,
  getIndexStatus,
  waitForIndex,
} = await import('../../server/services/search/indexer')

afterAll(async () => {
  await closeConnections()
})

beforeEach(async () => {
  await resetDatabase()
})

async function gespeicherterWert(): Promise<Record<string, unknown>> {
  const [row] = await useDatabase()
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, SETTING_KEYS.ai))
  return row!.value as Record<string, unknown>
}

describe('KI-Anbieter je Aufgabe', () => {
  it('übernimmt eine Konfiguration ohne Rollen unverändert für alle Aufgaben', async () => {
    // So liegt die Konfiguration bei bestehenden Installationen in der Datenbank.
    await useDatabase().insert(appSettings).values({
      key: SETTING_KEYS.ai,
      value: {
        enabled: true,
        provider: 'openai',
        baseUrl: '',
        apiKey: encryptSecret('sk-bestand'),
        chatModel: 'gpt-4o-mini',
        visionModel: 'gpt-4o',
        embeddingsEnabled: true,
        embeddingModel: 'text-embedding-3-small',
      },
    })

    const settings = await getAiSettings()
    expect(settings.rollen).toEqual({
      chat: { provider: 'standard', baseUrl: '', apiKey: '' },
      vision: { provider: 'standard', baseUrl: '', apiKey: '' },
      embedding: { provider: 'standard', baseUrl: '', apiKey: '' },
    })
    for (const rolle of ['chat', 'vision', 'embedding'] as const) {
      expect(aiVerbindung(settings, rolle)).toEqual({
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-bestand',
      })
    }
  })

  it('speichert Schlüssel der Aufgaben verschlüsselt und behält sie ohne neue Eingabe', async () => {
    await saveAiSettings({
      enabled: true,
      provider: 'ollama',
      chatModel: 'gemma',
      visionModel: 'gpt-4o',
      rollen: { vision: { provider: 'openai', baseUrl: '', apiKey: 'sk-vision-geheim' } },
    })

    const roh = await gespeicherterWert()
    expect(JSON.stringify(roh)).not.toContain('sk-vision-geheim')
    expect(aiVerbindung(await getAiSettings(), 'vision')).toEqual({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-vision-geheim',
    })

    // Ohne `apiKey` bleibt der Schlüssel, andere Rollen bleiben unberührt.
    await saveAiSettings({ rollen: { vision: { provider: 'openai', baseUrl: 'https://proxy.example/v1' } } })
    const danach = await getAiSettings()
    expect(danach.rollen?.vision).toEqual({
      provider: 'openai',
      baseUrl: 'https://proxy.example/v1',
      apiKey: 'sk-vision-geheim',
    })
    expect(aiVerbindung(danach, 'embedding').provider).toBe('ollama')

    // Zurück zum Standardanbieter: Der eigene Schlüssel wird gelöscht.
    await saveAiSettings({ rollen: { vision: { provider: 'standard', baseUrl: '', apiKey: null } } })
    const zurueck = await getAiSettings()
    expect(zurueck.rollen?.vision).toEqual({ provider: 'standard', baseUrl: '', apiKey: '' })
    expect(aiVerbindung(zurueck, 'vision').provider).toBe('ollama')
  })

  it('verwirft Vektoren, wenn derselbe Modellname von einem anderen Server kommt', async () => {
    const userId = (await createTestUser()).id
    await saveAiSettings({
      enabled: true,
      provider: 'ollama',
      chatModel: 'gemma',
      embeddingsEnabled: true,
      embeddingModel: 'nomic-embed-text',
    })
    await createMaterial({ title: 'Bruchrechnung' }, userId)
    await waitForIndex()
    while ((await embedPendingDocuments(64)) > 0) {
      // Alle Abschnitte mit Vektoren versehen.
    }
    expect((await getIndexStatus()).pending).toBe(0)
    const vorher = await getAiSettings()

    // Nur ein neuer Schlüssel: gleicher Server, die Vektoren bleiben.
    await saveAiSettings({
      rollen: { embedding: { provider: 'standard', baseUrl: '', apiKey: null } },
      apiKey: 'neu',
    })
    expect(await embeddingsNachAnbieterwechselVerwerfen(vorher, await getAiSettings())).toBe(false)
    expect((await getIndexStatus()).pending).toBe(0)

    // Gleicher Modellname bei einem anderen Server: Vektoren passen nicht mehr sicher.
    await saveAiSettings({
      rollen: { embedding: { provider: 'openai_kompatibel', baseUrl: 'http://llama:8080/v1' } },
    })
    const nachher = await getAiSettings()
    expect(await embeddingsNachAnbieterwechselVerwerfen(vorher, nachher)).toBe(true)
    const status = await getIndexStatus()
    expect(status.embedded).toBe(0)
    expect(status.pending).toBe(status.documents)
    expect(status.outdated).toBe(0)

    // Ein anderer Modellname braucht kein Verwerfen – die Vektoren gelten ohnehin als veraltet.
    await saveAiSettings({ embeddingModel: 'qwen3-embedding' })
    expect(await embeddingsNachAnbieterwechselVerwerfen(nachher, await getAiSettings())).toBe(false)
  })
})
