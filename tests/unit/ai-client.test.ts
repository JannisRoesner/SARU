import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatCompletion } from '../../server/services/ai/client'
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
})
