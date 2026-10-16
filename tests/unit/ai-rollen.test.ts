import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatCompletion, chatRolle, createEmbeddings, testConnection } from '../../server/services/ai/client'
import {
  aiModell,
  aiSettingsFuerClient,
  aiSettingsFuerRolle,
  aiSettingsMitEntwurf,
  aiVerbindung,
  defaultAiSettings,
  standardRollen,
  type AiSettings,
} from '../../server/services/settings.service'

/** Ältere Installation: ein Anbieter für alles, ohne `rollen`. */
const einAnbieter: AiSettings = {
  ...defaultAiSettings,
  enabled: true,
  provider: 'openai_kompatibel',
  baseUrl: 'http://lokal:8080/v1',
  apiKey: '',
  chatModel: 'gemma-chat',
  visionModel: 'gemma-vision',
  embeddingsEnabled: true,
  embeddingModel: 'qwen3-embedding',
  rollen: undefined,
}

/** Vision und Chat extern, Embeddings bleiben auf dem lokalen Standardanbieter. */
const gemischt: AiSettings = {
  ...einAnbieter,
  chatModel: 'gpt-4o-mini',
  visionModel: 'gpt-4o',
  rollen: {
    ...standardRollen(),
    chat: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-chat' },
    vision: { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-vision' },
  },
}

function antwortMit(text: string) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }),
    { status: 200 },
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Verbindung je Aufgabe', () => {
  it('nutzt ohne Rollen für alle Aufgaben den Standardanbieter', () => {
    for (const rolle of ['chat', 'vision', 'embedding'] as const) {
      expect(aiVerbindung(einAnbieter, rolle)).toEqual({
        provider: 'openai_kompatibel',
        baseUrl: 'http://lokal:8080/v1',
        apiKey: '',
      })
    }
  })

  it('löst eigene Anbieter auf und lässt „standard“ beim Standardanbieter', () => {
    expect(aiVerbindung(gemischt, 'chat').provider).toBe('openai')
    expect(aiVerbindung(gemischt, 'vision')).toEqual({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-vision',
    })
    expect(aiVerbindung(gemischt, 'embedding').provider).toBe('openai_kompatibel')
  })

  it('ergänzt die Standard-URL, wenn eine Aufgabe keine eigene Adresse hat', () => {
    const settings: AiSettings = {
      ...einAnbieter,
      rollen: { ...standardRollen(), embedding: { provider: 'ollama', baseUrl: '', apiKey: '' } },
    }
    expect(aiVerbindung(settings, 'embedding').baseUrl).toBe('http://localhost:11434/v1')
  })

  it('lässt Vision ohne eigenes Modell über den Chat-Anbieter laufen', () => {
    const ohneVisionModell = { ...gemischt, visionModel: '' }
    expect(aiVerbindung(ohneVisionModell, 'vision').provider).toBe('openai')
    expect(aiModell(ohneVisionModell, 'vision')).toBe('gpt-4o-mini')
  })

  it('richtet die Konfiguration für eine Aufgabe aus und behält die übrigen Wege', () => {
    const vision = aiSettingsFuerRolle(gemischt, 'vision')
    expect(vision.provider).toBe('openrouter')
    expect(vision.apiKey).toBe('sk-vision')
    expect(vision.chatModel).toBe('gpt-4o')
    // Folgeschritte eines Vision-Laufs bleiben beim Vision-Anbieter …
    expect(aiVerbindung(vision, 'chat').provider).toBe('openrouter')
    // … Embeddings bleiben lokal.
    expect(aiVerbindung(vision, 'embedding').provider).toBe('openai_kompatibel')

    // Eine Texterkennung innerhalb eines Chat-Laufs geht weiter an den Vision-Anbieter.
    const chat = aiSettingsFuerRolle(gemischt, 'chat')
    expect(chat.provider).toBe('openai')
    expect(aiVerbindung(chat, 'vision').provider).toBe('openrouter')
    expect(aiVerbindung(aiSettingsFuerRolle(chat, 'vision'), 'vision').apiKey).toBe('sk-vision')
  })

  it('ist für bereits ausgerichtete Konfigurationen stabil', () => {
    const einmal = aiSettingsFuerRolle(gemischt, 'chat')
    const zweimal = aiSettingsFuerRolle(einmal, 'chat')
    expect(aiVerbindung(zweimal, 'chat')).toEqual(aiVerbindung(einmal, 'chat'))
    expect(aiVerbindung(zweimal, 'vision')).toEqual(aiVerbindung(einmal, 'vision'))
    expect(aiVerbindung(zweimal, 'embedding')).toEqual(aiVerbindung(einmal, 'embedding'))
  })
})

describe('Zuordnung von Chat-Anfragen', () => {
  const nurText = [{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'Hallo' }] }]
  const mitBild = [
    {
      role: 'user' as const,
      parts: [
        { type: 'text' as const, text: 'Was steht hier?' },
        { type: 'image' as const, mimeType: 'image/png', base64: 'AAAA' },
      ],
    },
  ]

  it('wählt die Aufgabe nach ausdrücklichem Modell, sonst nach Inhalt', () => {
    expect(chatRolle(gemischt, nurText)).toBe('chat')
    expect(chatRolle(gemischt, mitBild)).toBe('vision')
    expect(chatRolle(gemischt, nurText, 'gpt-4o')).toBe('vision')
    expect(chatRolle(gemischt, mitBild, 'gpt-4o-mini')).toBe('chat')
    // Gleicher Name für Chat und Vision: dann entscheidet der Inhalt.
    expect(chatRolle(einAnbieter, mitBild, 'gemma-chat')).toBe('chat')
    expect(chatRolle({ ...einAnbieter, visionModel: 'gemma-chat' }, mitBild, 'gemma-chat')).toBe('vision')
  })

  it('schickt Text an den Chat- und Bilder an den Vision-Anbieter', async () => {
    const aufrufe: { url: string; auth: string | undefined; model: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      aufrufe.push({ url, auth: headers.Authorization, model: JSON.parse(String(init?.body)).model })
      return antwortMit('ok')
    }))

    await chatCompletion(gemischt, nurText)
    await chatCompletion(gemischt, mitBild, { model: gemischt.visionModel })

    expect(aufrufe).toEqual([
      { url: 'https://api.openai.com/v1/chat/completions', auth: 'Bearer sk-chat', model: 'gpt-4o-mini' },
      { url: 'https://openrouter.ai/api/v1/chat/completions', auth: 'Bearer sk-vision', model: 'gpt-4o' },
    ])
  })

  it('verhält sich ohne Rollen wie bisher', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      return antwortMit('ok')
    }))

    await chatCompletion(einAnbieter, nurText)
    await chatCompletion(einAnbieter, mitBild, { model: einAnbieter.visionModel })

    expect(urls).toEqual([
      'http://lokal:8080/v1/chat/completions',
      'http://lokal:8080/v1/chat/completions',
    ])
  })

  it('erzwingt eine Aufgabe über die Option `rolle`', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      return antwortMit('ok')
    }))
    await chatCompletion(gemischt, nurText, { rolle: 'vision' })
    expect(urls).toEqual(['https://openrouter.ai/api/v1/chat/completions'])
  })
})

describe('Embeddings je Aufgabe', () => {
  it('rechnet Vektoren beim Embedding-Anbieter, auch wenn Chat extern läuft', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('http://lokal:8080/v1/embeddings')
      expect((init?.headers as Record<string, string>).Authorization).toBeUndefined()
      return new Response(JSON.stringify({ data: [{ embedding: [1, 0] }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const [vektor] = await createEmbeddings(gemischt, ['Text'], 4)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(vektor).toEqual([1, 0, 0, 0])
  })

  it('nutzt für einen externen Embedding-Anbieter dessen Schlüssel und Modellauflösung', async () => {
    const settings: AiSettings = {
      ...einAnbieter,
      embeddingModel: 'text-embedding-3-small',
      rollen: {
        ...standardRollen(),
        embedding: { provider: 'openai', baseUrl: '', apiKey: 'sk-embed' },
      },
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.openai.com/v1/embeddings')
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-embed')
      // OpenAI begrenzt die Dimension selbst – das gilt nur, weil der Embedding-Anbieter OpenAI ist.
      expect(JSON.parse(String(init?.body)).dimensions).toBe(8)
      return new Response(JSON.stringify({ data: [{ embedding: new Array(8).fill(0.5) }] }), { status: 200 })
    }))

    await createEmbeddings(settings, ['Text'], 8)
  })
})

describe('Verbindungstest je Aufgabe', () => {
  it('prüft den eigenen Server einer Aufgabe, auch ohne gewähltes Modell', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      return new Response(JSON.stringify({ data: [{ id: 'gpt-4o' }] }), { status: 200 })
    }))

    const result = await testConnection({ ...gemischt, visionModel: '' }, 'vision')
    expect(result.ok).toBe(true)
    expect(urls).toEqual(['https://openrouter.ai/api/v1/models'])
  })

  it('testet das Embedding-Modell nur über die Verbindung, die es tatsächlich nutzt', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      if (url.endsWith('/embeddings')) {
        return new Response(JSON.stringify({ data: [{ embedding: [1] }] }), { status: 200 })
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    }))

    const embeddingExtern: AiSettings = {
      ...einAnbieter,
      rollen: { ...standardRollen(), embedding: { provider: 'openrouter', baseUrl: '', apiKey: 'k' } },
    }
    await testConnection(embeddingExtern)
    expect(urls).toEqual(['http://lokal:8080/v1/models'])

    urls.length = 0
    await testConnection(embeddingExtern, 'embedding')
    expect(urls).toEqual(['https://openrouter.ai/api/v1/models', 'https://openrouter.ai/api/v1/embeddings'])
  })
})

describe('Formularstand und Auslieferung', () => {
  it('übernimmt Entwürfe und behält leere Schlüssel aus der Konfiguration', () => {
    const entwurf = aiSettingsMitEntwurf(gemischt, {
      rollen: {
        vision: { provider: 'openai', baseUrl: '', apiKey: '' },
        embedding: { provider: 'ollama' },
      },
    })
    expect(entwurf.rollen?.vision).toEqual({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-vision',
    })
    expect(entwurf.rollen?.embedding.baseUrl).toBe('http://localhost:11434/v1')
    expect(entwurf.rollen?.chat.apiKey).toBe('sk-chat')
  })

  it('maskiert alle Schlüssel für den Client', () => {
    const client = aiSettingsFuerClient({ ...gemischt, apiKey: 'sk-standard-geheim' })
    const text = JSON.stringify(client)
    expect(text).not.toContain('sk-standard-geheim')
    expect(text).not.toContain('sk-chat')
    expect(text).not.toContain('sk-vision')
    expect(client.rollen.vision.apiKeyGesetzt).toBe(true)
    expect(client.rollen.embedding.apiKeyGesetzt).toBe(false)
  })
})
