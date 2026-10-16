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
