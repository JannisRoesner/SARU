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
  it('nutzt für Ollamas /v1-Endpunkt response_format und liefert finish_reason zurück', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body.response_format).toEqual({ type: 'json_object' })
      expect(body).not.toHaveProperty('format')
      expect(body.max_tokens).toBe(4000)
      return new Response(
        JSON.stringify({
          model: 'gemma4:e4b-it-qat',
          choices: [
            {
              message: { content: '{"summary":"Test","answers":[],"formFields":[]}' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
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
})
