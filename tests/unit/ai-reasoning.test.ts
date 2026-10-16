import { afterEach, describe, expect, it, vi } from 'vitest'
import * as aiClient from '../../server/services/ai/client'
import { suggestMaterialMetadata } from '../../server/services/ai/suggest-material-metadata'
import { defaultAiSettings, type AiSettings } from '../../server/services/settings.service'

const openrouter: AiSettings = {
  ...defaultAiSettings,
  enabled: true,
  provider: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'sk-test',
  chatModel: 'deepseek/deepseek-v4.1-flash',
  visionModel: '',
}

const frage = [{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'JSON bitte' }] }]

function antwort(text: string) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }),
    { status: 200 },
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Denkmodus bei OpenRouter', () => {
  it('schaltet das Denken ab, damit es nicht das Ausgabebudget verbraucht', async () => {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return antwort('{"ok":true}')
    }))

    await aiClient.chatCompletion(openrouter, frage, { jsonMode: true })
    expect(bodies[0]!.reasoning).toEqual({ effort: 'none' })
  })

  it('wiederholt ohne Vorgabe, wenn ein Modell das Denken nicht abschalten lässt', async () => {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      bodies.push(body)
      if (body.reasoning) {
        return new Response(
          JSON.stringify({ error: { message: 'Reasoning is mandatory for this endpoint and cannot be disabled.' } }),
          { status: 400 },
        )
      }
      return antwort('{"ok":true}')
    }))

    const settings = { ...openrouter, chatModel: 'pflicht/denker' }
    const result = await aiClient.chatCompletion(settings, frage)
    expect(result.text).toBe('{"ok":true}')
    expect(bodies.map((body) => 'reasoning' in body)).toEqual([true, false])

    // Danach merkt sich der Prozess das Modell und fragt gleich ohne Vorgabe.
    bodies.length = 0
    await aiClient.chatCompletion(settings, frage)
    expect(bodies.map((body) => 'reasoning' in body)).toEqual([false])
  })

  it('gibt andere Fehler unverändert weiter', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'Invalid model' } }), { status: 400 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(aiClient.chatCompletion({ ...openrouter, chatModel: 'gibt/es-nicht' }, frage)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('lässt andere Anbieter unberührt', async () => {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return antwort('ok')
    }))
    await aiClient.chatCompletion({ ...openrouter, provider: 'openai', baseUrl: 'https://api.openai.com/v1' }, frage)
    expect(bodies[0]!.reasoning).toBeUndefined()
  })
})

describe('Budget der Metadaten-Vorschläge', () => {
  it('gibt dem zweiten Versuch mehr Ausgabebudget, wenn die Antwort abgeschnitten war', async () => {
    const budgets: (number | undefined)[] = []
    vi.spyOn(aiClient, 'chatCompletion').mockImplementation(async (_settings, _messages, options) => {
      budgets.push(options?.maxOutputTokens)
      if (budgets.length === 1) {
        return { text: '{\n  "title": "Abgeschnit', model: 'm', finishReason: 'length', outputTokens: 800 }
      }
      return {
        text: JSON.stringify({ title: 'Vollständig', materialType: 'arbeitsblatt', description: 'Text' }),
        model: 'm',
        finishReason: 'stop',
        outputTokens: 120,
      }
    })

    const result = await suggestMaterialMetadata({
      fileName: 'AB_Zelle.pdf',
      extractedText: 'Die Zelle',
      settings: { ...openrouter, maxOutputTokens: 4000 },
    })
    expect(result.aiUsed).toBe(true)
    expect(result.title).toBe('Vollständig')
    expect(budgets).toEqual([800, 2000])
  })
})

describe('Denkbudget für Musterlösungen', () => {
  function mitschneiden(content = '{"ok":true}', extra: Record<string, unknown> = {}) {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(
        JSON.stringify({ choices: [{ message: { content, ...extra }, finish_reason: 'stop' }], ...extra }),
        { status: 200 },
      )
    }))
    return bodies
  }

  it('gibt dem Denken bei OpenRouter ein eigenes Budget zusätzlich zur Antwort', async () => {
    const bodies = mitschneiden()
    await aiClient.chatCompletion(openrouter, frage, { maxOutputTokens: 1200, denkBudget: 3000 })
    expect(bodies[0]!.reasoning).toEqual({ max_tokens: 3000 })
    expect(bodies[0]!.max_tokens).toBe(4200)
  })

  it('bleibt ohne Denkbudget beim abgeschalteten Denken', async () => {
    const bodies = mitschneiden()
    await aiClient.chatCompletion(openrouter, frage, { maxOutputTokens: 1200, denkBudget: 0 })
    expect(bodies[0]!.reasoning).toEqual({ effort: 'none' })
    expect(bodies[0]!.max_tokens).toBe(1200)
  })

  it('schaltet bei OpenAI-kompatiblen Servern das Denken ein und erhöht das Limit', async () => {
    const bodies = mitschneiden()
    const settings: AiSettings = { ...openrouter, provider: 'openai_kompatibel', baseUrl: 'http://localhost:8080/v1' }
    await aiClient.chatCompletion(settings, frage, { maxOutputTokens: 1000, denkBudget: 2000 })
    expect(bodies[0]!.chat_template_kwargs).toEqual({ enable_thinking: true })
    expect(bodies[0]!.max_tokens).toBe(3000)
    expect(bodies[0]!.reasoning).toBeUndefined()

    await aiClient.chatCompletion(settings, frage, { maxOutputTokens: 1000 })
    expect(bodies[1]!.chat_template_kwargs).toEqual({ enable_thinking: false })
    expect(bodies[1]!.max_tokens).toBe(1000)
  })

  it('nimmt bei eingeschaltetem Denken nie den Denkkanal als Antwort', async () => {
    mitschneiden('', { reasoning_content: '{"gedacht":true}' })
    const settings: AiSettings = { ...openrouter, provider: 'openai_kompatibel', baseUrl: 'http://localhost:8080/v1' }
    await expect(aiClient.chatCompletion(settings, frage, { denkBudget: 2000 })).rejects.toThrow()
    await expect(aiClient.chatCompletion(settings, frage)).resolves.toMatchObject({ text: '{"gedacht":true}' })
  })

  it('schaltet bei Ollama think ein und schlägt das Budget auf num_predict auf', async () => {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ message: { content: '{"ok":true}' }, done_reason: 'stop' }), { status: 200 })
    }))
    const settings: AiSettings = { ...openrouter, provider: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: '' }
    await aiClient.chatCompletion(settings, frage, { maxOutputTokens: 900, denkBudget: 1500 })
    await aiClient.chatCompletion(settings, frage, { maxOutputTokens: 900 })
    expect(bodies.map((body) => body.think)).toEqual([true, false])
    expect(bodies.map((body) => (body.options as { num_predict: number }).num_predict)).toEqual([2400, 900])
  })

  it('lässt OpenAI unverändert', async () => {
    const bodies = mitschneiden()
    const settings: AiSettings = { ...openrouter, provider: 'openai', baseUrl: 'https://api.openai.com/v1' }
    await aiClient.chatCompletion(settings, frage, { maxOutputTokens: 1000, denkBudget: 2000 })
    expect(bodies[0]!.max_tokens).toBe(1000)
    expect(bodies[0]!.reasoning).toBeUndefined()
  })

  it('liest das Budget nur bei eingeschaltetem Denkmodus aus den Einstellungen', () => {
    expect(aiClient.musterloesungDenkBudget(openrouter)).toBeUndefined()
    expect(aiClient.musterloesungDenkBudget({ ...openrouter, denkmodusMusterloesungen: true, denkBudget: 2500 })).toBe(2500)
    expect(aiClient.musterloesungDenkBudget({ ...openrouter, denkmodusMusterloesungen: true, denkBudget: 0 })).toBeUndefined()
  })
})
