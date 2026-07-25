import { describe, expect, it } from 'vitest'
import {
  getEmbeddingModelWarning,
  isOpenAiEmbeddingModel,
  OLLAMA_EMBEDDING_MODEL,
  resolveEmbeddingModel,
} from '#shared/utils/embeddings'
import { fitDimensions } from '../../server/services/ai/client'

describe('embeddings', () => {
  it('erkennt OpenAI-Embedding-Modellnamen', () => {
    expect(isOpenAiEmbeddingModel('text-embedding-3-small')).toBe(true)
    expect(isOpenAiEmbeddingModel('openai/text-embedding-3-small')).toBe(true)
    expect(isOpenAiEmbeddingModel('nomic-embed-text')).toBe(false)
  })

  it('mappt OpenAI-Modelle bei Ollama auf qwen3-embedding:8b', () => {
    expect(resolveEmbeddingModel('ollama', 'text-embedding-3-small')).toBe(OLLAMA_EMBEDDING_MODEL)
    expect(resolveEmbeddingModel('ollama', 'nomic-embed-text')).toBe('nomic-embed-text')
    expect(resolveEmbeddingModel('ollama', '')).toBe(OLLAMA_EMBEDDING_MODEL)
    expect(resolveEmbeddingModel('openai', 'text-embedding-3-small')).toBe('text-embedding-3-small')
  })

  it('liefert einen Hinweis bei inkompatiblem Ollama-Modell', () => {
    const warnung = getEmbeddingModelWarning('ollama', 'text-embedding-3-small')
    expect(warnung).toContain('text-embedding-3-small')
    expect(warnung).toContain(OLLAMA_EMBEDDING_MODEL)
  })

  it('passt kleinere Vektoren per Null-Padding an', () => {
    const vector = [3, 4]
    const padded = fitDimensions(vector, 4)
    expect(padded).toEqual([3, 4, 0, 0])
  })

  it('normalisiert gekürzte Vektoren', () => {
    const vector = [3, 4, 0, 0]
    const truncated = fitDimensions(vector, 2)
    expect(truncated[0]!).toBeCloseTo(0.6)
    expect(truncated[1]!).toBeCloseTo(0.8)
  })
})

describe('createEmbeddings against Ollama', () => {
  async function ollamaReachable(): Promise<boolean> {
    try {
      const response = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) })
      return response.ok
    } catch {
      return false
    }
  }

  async function ollamaHasModel(model: string): Promise<boolean> {
    try {
      const response = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) })
      if (!response.ok) return false
      const payload = (await response.json()) as { models?: { name: string }[] }
      const names = payload.models?.map((entry) => entry.name) ?? []
      return names.some((name) => name === model || name.startsWith(`${model}:`))
    } catch {
      return false
    }
  }

  it('ruft qwen3-embedding:8b über die OpenAI-kompatible API auf', async () => {
    if (process.env.SARU_SKIP_OLLAMA_TESTS === 'true') return
    if (!(await ollamaReachable())) return
    if (!(await ollamaHasModel(OLLAMA_EMBEDDING_MODEL))) return

    const { createEmbeddings } = await import('../../server/services/ai/client')
    const [vector] = await createEmbeddings(
      {
        enabled: true,
        provider: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        chatModel: '',
        visionModel: '',
        useVision: false,
        embeddingsEnabled: true,
        embeddingModel: OLLAMA_EMBEDDING_MODEL,
        temperature: 0.2,
        maxOutputTokens: 100,
        timeoutMs: 120_000,
        refererUrl: '',
        appTitle: 'SARU',
      },
      ['Deutsch Unterricht Mathematik'],
      1536,
    )

    expect(vector).toHaveLength(1536)
    expect(vector.some((value) => value !== 0)).toBe(true)
  })

  it('fällt bei Ollama auf qwen3-embedding:8b zurück, wenn OpenAI-Modell gespeichert ist', async () => {
    if (process.env.SARU_SKIP_OLLAMA_TESTS === 'true') return
    if (!(await ollamaReachable())) return
    if (!(await ollamaHasModel(OLLAMA_EMBEDDING_MODEL))) return

    const { createEmbeddings } = await import('../../server/services/ai/client')
    const [vector] = await createEmbeddings(
      {
        enabled: true,
        provider: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        chatModel: '',
        visionModel: '',
        useVision: false,
        embeddingsEnabled: true,
        embeddingModel: 'text-embedding-3-small',
        temperature: 0.2,
        maxOutputTokens: 100,
        timeoutMs: 120_000,
        refererUrl: '',
        appTitle: 'SARU',
      },
      ['Fallback-Test'],
      1536,
    )

    expect(vector).toHaveLength(1536)
  })
})
