import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatCompletion, createEmbeddings, listModels, parseModelList, testConnection } from '../../server/services/ai/client'
import type { AiSettings } from '../../server/services/settings.service'

const settings: AiSettings = {
  enabled: true,
  provider: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  apiKey: '',
  chatModel: 'gemma4:e4b-it-qat',
  visionModel: 'gemma4:e4b-it-qat',
  useVision: true,
  embeddingsEnabled: false,
  embeddingModel: '',
  temperature: 0.2,
  maxOutputTokens: 4000,
  timeoutMs: 10_000,
  refererUrl: '',
  appTitle: 'SARU Test',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('chatCompletion', () => {
  it('nutzt Ollamas nativen Chat-Endpunkt mit deaktiviertem Thinking', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(url).toBe('http://localhost:11434/api/chat')
      expect(body.format).toBe('json')
      expect(body.think).toBe(false)
      expect(body.stream).toBe(false)
      expect(body.options).toEqual({ temperature: 0.2, num_predict: 4000 })
      return new Response(
        JSON.stringify({
          model: 'gemma4:e4b-it-qat',
          message: { content: '{"summary":"Test","answers":[],"formFields":[]}' },
          done_reason: 'stop',
          prompt_eval_count: 100,
          eval_count: 20,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await chatCompletion(
      settings,
      [{ role: 'user', parts: [{ type: 'text', text: 'JSON bitte' }] }],
      { jsonMode: true },
    )

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(result.finishReason).toBe('stop')
    expect(result.outputTokens).toBe(20)
  })

  it('überträgt ein JSON-Schema über Ollamas natives format-Feld', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body.format).toEqual({ type: 'object', properties: { value: { type: 'string' } } })
      return new Response(JSON.stringify({ message: { content: '{"value":"ok"}' } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await chatCompletion(
      settings,
      [{ role: 'user', parts: [{ type: 'text', text: 'JSON bitte' }] }],
      { jsonMode: true, jsonSchema: { name: 'ignored-by-ollama', schema: { type: 'object', properties: { value: { type: 'string' } } } } },
    )

    expect(result.text).toBe('{"value":"ok"}')
  })

  it('akzeptiert keinen leeren nativen Antwortkanal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        message: { content: '', thinking: '{"taskId":"t1","answers":[],"uncertainties":[]}' },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )))

    await expect(chatCompletion(
      settings,
      [{ role: 'user', parts: [{ type: 'text', text: 'JSON bitte' }] }],
      { jsonMode: true },
    )).rejects.toThrow('keine Antwort')
  })

  it('spricht OpenAI-kompatible Server (llama.cpp) über /chat/completions ohne Schlüssel an', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(url).toBe('http://192.168.1.5:8080/v1/chat/completions')
      expect((init?.headers as Record<string, string>).Authorization).toBeUndefined()
      expect(body.chat_template_kwargs).toEqual({ enable_thinking: false })
      expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'antwort' } })
      expect(body.messages).toEqual([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Was steht hier?' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
          ],
        },
      ])
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"value":"ok"}' }, finish_reason: 'stop' }] }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await chatCompletion(
      { ...settings, provider: 'openai_kompatibel', baseUrl: 'http://192.168.1.5:8080/v1/' },
      [{ role: 'user', parts: [{ type: 'text', text: 'Was steht hier?' }, { type: 'image', mimeType: 'image/png', base64: 'AAAA' }] }],
      { jsonSchema: { name: 'antwort', schema: { type: 'object' } } },
    )
    expect(result.text).toBe('{"value":"ok"}')
  })

  it('übernimmt JSON aus llama.cpps reasoning_content, wenn content leer bleibt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: '', reasoning_content: '{"value":"ok"}' } }] }),
      { status: 200 },
    )))
    const result = await chatCompletion(
      { ...settings, provider: 'openai_kompatibel' },
      [{ role: 'user', parts: [{ type: 'text', text: 'JSON bitte' }] }],
      { jsonMode: true },
    )
    expect(result.text).toBe('{"value":"ok"}')
  })
})

describe('createEmbeddings', () => {
  const embeddingSettings: AiSettings = {
    ...settings,
    provider: 'openai_kompatibel',
    embeddingsEnabled: true,
    embeddingModel: 'embeddinggemma-2',
  }

  /** Verhält sich wie llama-server mit Standard-Batchgröße: lange Texte → 500. */
  function llamaServer(maxZeichen: number) {
    return vi.fn(async (_url: string, init?: RequestInit) => {
      const { input } = JSON.parse(String(init?.body)) as { input: string[] }
      if (input.some((text) => text.length > maxZeichen)) {
        return new Response(
          JSON.stringify({
            error: {
              code: 500,
              message: 'input (1702 tokens) is too large to process. increase the physical batch size (current batch size: 512)',
              type: 'server_error',
            },
          }),
          { status: 500 },
        )
      }
      return new Response(JSON.stringify({ data: input.map(() => ({ embedding: [1, 0, 0] })) }), { status: 200 })
    })
  }

  it('kürzt zu lange Texte schrittweise, bis der Server sie annimmt', async () => {
    const fetchMock = llamaServer(1500)
    vi.stubGlobal('fetch', fetchMock)

    const vektoren = await createEmbeddings(embeddingSettings, ['kurz', 'x'.repeat(8000)], 4)

    expect(vektoren).toEqual([[1, 0, 0, 0], [1, 0, 0, 0]])
    // 8000 → 4000 → 2000 → 1000 Zeichen
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const letzte = JSON.parse(String(fetchMock.mock.calls.at(-1)![1]!.body)) as { input: string[] }
    expect(letzte.input.map((t) => t.length)).toEqual([4, 1000])
  })

  it('gibt andere Serverfehler sofort weiter', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":{"message":"model not loaded"}}', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createEmbeddings(embeddingSettings, ['x'.repeat(8000)], 4)).rejects.toThrow(/Embedding-Modell/)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

/** Gekürzte Antwort eines llama.cpp-Routers (llama-server mit Modell-Presets). */
const LLAMACPP_MODELS = {
  data: [
    { id: 'gemma4-e4b-qat', aliases: ['gemma4:e4b-it-qat'], owned_by: 'llamacpp', architecture: { input_modalities: ['text', 'image', 'audio'], output_modalities: ['text'] } },
    { id: 'ggml-org/embeddinggemma-2-GGUF:Q8_0', aliases: [], architecture: { input_modalities: ['text', 'image', 'audio'], output_modalities: ['text'] } },
    { id: 'k2-horizon-3.7b', aliases: ['K2-Horizon-3.7B-Q4_K_M'], architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
    { id: 'qwen3-embedding-small', aliases: ['qwen3-embedding:0.6b'], architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
  ],
}

describe('Modellliste', () => {
  it('liest Aliase und Fähigkeiten aus der llama.cpp-Antwort', () => {
    expect(parseModelList(LLAMACPP_MODELS)).toEqual([
      { id: 'gemma4-e4b-qat', aliase: ['gemma4:e4b-it-qat'], bild: true, embedding: null },
      { id: 'ggml-org/embeddinggemma-2-GGUF:Q8_0', aliase: [], bild: false, embedding: true },
      { id: 'k2-horizon-3.7b', aliase: ['K2-Horizon-3.7B-Q4_K_M'], bild: false, embedding: null },
      { id: 'qwen3-embedding-small', aliase: ['qwen3-embedding:0.6b'], bild: false, embedding: true },
    ])
  })

  it('lässt Fähigkeiten offen, wenn der Server nur IDs liefert (OpenAI)', () => {
    expect(parseModelList({ data: [{ id: 'gpt-4o-mini' }, { id: 'text-embedding-3-small' }, { id: 42 }] })).toEqual([
      { id: 'gpt-4o-mini', aliase: [], bild: null, embedding: null },
      { id: 'text-embedding-3-small', aliase: [], bild: false, embedding: true },
    ])
  })

  it('warnt, wenn „Ollama“ gewählt ist, aber llama.cpp antwortet', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/v1/models')) return new Response(JSON.stringify(LLAMACPP_MODELS), { status: 200 })
      if (url.endsWith('/api/tags')) return new Response('{"error":{"message":"File Not Found"}}', { status: 404 })
      throw new Error(`unerwartet: ${url}`)
    }))

    const liste = await listModels({ ...settings, baseUrl: 'http://192.168.1.5:11434/v1' })
    expect(liste.modelle).toHaveLength(4)
    expect(liste.warnung).toMatch(/kein Ollama/)

    const test = await testConnection({ ...settings, baseUrl: 'http://192.168.1.5:11434/v1' })
    expect(test.ok).toBe(false)
    expect(test.message).toMatch(/OpenAI-kompatibel/)
  })

  it('ergänzt bei echtem Ollama die Fähigkeiten über /api/show', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'gemma4:e4b-it-qat' }, { id: 'qwen3-embedding:8b' }] }), { status: 200 })
      }
      if (url.endsWith('/api/tags')) return new Response('{"models":[]}', { status: 200 })
      if (url.endsWith('/api/show')) {
        const { model } = JSON.parse(String(init?.body)) as { model: string }
        const capabilities = model.startsWith('gemma') ? ['completion', 'vision'] : ['embedding']
        return new Response(JSON.stringify({ capabilities }), { status: 200 })
      }
      throw new Error(`unerwartet: ${url}`)
    }))

    const liste = await listModels(settings)
    expect(liste.warnung).toBeNull()
    expect(liste.modelle).toEqual([
      { id: 'gemma4:e4b-it-qat', aliase: [], bild: true, embedding: false },
      { id: 'qwen3-embedding:8b', aliase: [], bild: false, embedding: true },
    ])
  })
})
