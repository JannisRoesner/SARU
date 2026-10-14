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
    return provider === 'ollama' || provider === 'openai_kompatibel'
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

/**
 * Manche Embedding-Modelle sind auf Aufgaben-Präfixe trainiert und liefern ohne
 * sie deutlich schlechtere Suchergebnisse – vor allem bei kurzen Anfragen.
 */
interface PromptFormat {
  /** Erhöhen, wenn sich das Format ändert – gespeicherte Vektoren werden dann neu berechnet. */
  version: number
  query: (text: string) => string
  document: (title: string, text: string) => string
}

const PROMPT_FORMATS: { pattern: RegExp; format: PromptFormat }[] = [
  {
    // https://ai.google.dev/gemma/docs/embeddinggemma/model_card#prompt-instructions
    // EmbeddingGemma 2 nutzt dasselbe Format: https://huggingface.co/google/embeddinggemma-2
    pattern: /embeddinggemma/i,
    format: {
      version: 1,
      query: (text) => `task: search result | query: ${text}`,
      document: (title, text) => `title: ${title.trim() || 'none'} | text: ${text}`,
    },
  },
  {
    // Qwen3-Embedding erwartet die Anweisung nur bei Anfragen, Dokumente bleiben unverändert.
    pattern: /qwen3-embedding/i,
    format: {
      version: 1,
      query: (text) =>
        `Instruct: Given a search query, retrieve relevant German teaching materials\nQuery:${text}`,
      document: (title, text) => [title, text].filter(Boolean).join('\n'),
    },
  },
]

function promptFormat(model: string): PromptFormat | null {
  return PROMPT_FORMATS.find((entry) => entry.pattern.test(model))?.format ?? null
}

/** Bereitet eine Suchanfrage für das Embedding-Modell vor. */
export function embeddingQueryInput(model: string, query: string): string {
  return promptFormat(model)?.query(query) ?? query
}

/** Bereitet einen Index-Abschnitt (Titel + Text) für das Embedding-Modell vor. */
export function embeddingDocumentInput(model: string, title: string, text: string): string {
  const format = promptFormat(model)
  return format ? format.document(title, text) : [title, text].filter(Boolean).join('\n')
}

/**
 * Kennung, unter der Vektoren gespeichert werden. Enthält die Version des
 * Prompt-Formats, damit Vektoren mit und ohne Präfix nie vermischt werden.
 */
export function embeddingIndexKey(model: string): string {
  const format = promptFormat(model)
  return format ? `${model} [Prompt v${format.version}]` : model
}
