import type { AiProvider } from '#shared/types/domain'

/** Standard-Embedding für Ollama – multilingual, hohe Qualität, gut für deutschsprachige Suche. */
export const OLLAMA_EMBEDDING_MODEL = 'qwen3-embedding:8b'

const OPENAI_ONLY_EMBEDDING = /^text-embedding-/i
const OPENROUTER_OPENAI_EMBEDDING = /^openai\/text-embedding-/i

export function isOpenAiEmbeddingModel(model: string): boolean {
  const trimmed = model.trim()
  return OPENAI_ONLY_EMBEDDING.test(trimmed) || OPENROUTER_OPENAI_EMBEDDING.test(trimmed)
}

/** Liefert das tatsächlich aufzurufende Modell (Runtime-Fallback für Ollama). */
export function resolveEmbeddingModel(provider: AiProvider, model: string): string {
  const trimmed = model.trim()
  if (!trimmed) {
    return provider === 'ollama'
      ? OLLAMA_EMBEDDING_MODEL
      : provider === 'openai'
        ? 'text-embedding-3-small'
        : 'openai/text-embedding-3-small'
  }

  if (provider === 'ollama' && isOpenAiEmbeddingModel(trimmed)) {
    return OLLAMA_EMBEDDING_MODEL
  }

  return trimmed
}

/** Hinweis für die Einstellungs-UI, wenn ein gespeichertes Modell zum Anbieter passt. */
export function getEmbeddingModelWarning(provider: AiProvider, model: string): string | null {
  const trimmed = model.trim()
  if (provider !== 'ollama' || !trimmed || !isOpenAiEmbeddingModel(trimmed)) return null

  return `„${trimmed}“ ist ein OpenAI-Modell und bei Ollama nicht verfügbar. Empfehlung: ${OLLAMA_EMBEDDING_MODEL} (ollama pull ${OLLAMA_EMBEDDING_MODEL}). Bestehende Vektoren sollten nach dem Wechsel neu erzeugt werden.`
}
