import { kiAnbieterFehlermeldung } from '#shared/utils/public-error'
import { resolveEmbeddingModel } from '#shared/utils/embeddings'
import { appError } from '../../utils/errors'
import { createLogger } from '../../utils/logger'
import { DEFAULT_BASE_URLS, type AiProviderId, type AiSettings } from '../settings.service'

const log = createLogger('ai:client')

export interface ChatTextPart {
  type: 'text'
  text: string
}

export interface ChatImagePart {
  type: 'image'
  mimeType: string
  base64: string
}

export interface ChatFilePart {
  type: 'file'
  mimeType: string
  base64: string
  fileName: string
}

export type ChatPart = ChatTextPart | ChatImagePart | ChatFilePart

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  parts: ChatPart[]
}

export interface ChatResult {
  text: string
  model: string
  inputTokens?: number
  outputTokens?: number
  /** Anbietergrund für das Ende, typischerweise `stop` oder `length`. */
  finishReason?: string | null
}

/** Anbieter, die PDF-Dateien direkt im Chat-Request akzeptieren. */
const NATIVE_PDF_PROVIDERS: AiProviderId[] = ['openai', 'openrouter']

export function supportsNativePdf(provider: AiProviderId): boolean {
  return NATIVE_PDF_PROVIDERS.includes(provider)
}

function baseUrl(settings: AiSettings): string {
  return (settings.baseUrl || DEFAULT_BASE_URLS[settings.provider]).replace(/\/+$/, '')
}

function headers(settings: AiSettings): Record<string, string> {
  const result: Record<string, string> = { 'Content-Type': 'application/json' }

  // Ollama läuft lokal und benötigt üblicherweise keinen Schlüssel.
  if (settings.apiKey) result.Authorization = `Bearer ${settings.apiKey}`
  else if (settings.provider !== 'ollama') {
    throw appError(
      'KI_NICHT_KONFIGURIERT',
      'Für diesen Anbieter ist kein API-Schlüssel hinterlegt. Bitte in den Einstellungen ergänzen.',
    )
  }

  if (settings.provider === 'openrouter') {
    if (settings.refererUrl) result['HTTP-Referer'] = settings.refererUrl
    result['X-Title'] = settings.appTitle || 'SARU'
  }

  return result
}

/** Übersetzt die anbieterunabhängigen Nachrichtenteile in das OpenAI-Format. */
function serializeParts(parts: ChatPart[], provider: AiProviderId): unknown {
  // Rein textliche Nachrichten als einfacher String – das versteht jeder Anbieter.
  if (parts.length === 1 && parts[0]!.type === 'text') {
    return (parts[0] as ChatTextPart).text
  }

  return parts.map((part) => {
    switch (part.type) {
      case 'text':
        return { type: 'text', text: part.text }
      case 'image':
        return {
          type: 'image_url',
          image_url: { url: `data:${part.mimeType};base64,${part.base64}` },
        }
      case 'file':
        if (!supportsNativePdf(provider)) {
          throw appError(
            'KI_FEHLER',
            'Der gewählte Anbieter kann keine PDF-Dateien direkt verarbeiten.',
          )
        }
        return {
          type: 'file',
          file: {
            filename: part.fileName,
            file_data: `data:${part.mimeType};base64,${part.base64}`,
          },
        }
    }
  })
}

interface ChatCompletionResponse {
  choices?: {
    message?: { content?: string | null }
    finish_reason?: string | null
  }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
  model?: string
}

export async function chatCompletion(
  settings: AiSettings,
  messages: ChatMessage[],
  options: {
    model?: string
    temperature?: number
    maxOutputTokens?: number
    /** Erzwingt JSON-Ausgabe über das OpenAI-kompatible response_format. */
    jsonMode?: boolean
    /** Striktes JSON Schema; derzeit nur für den sicher unterstützten OpenAI-Pfad. */
    jsonSchema?: { name: string; schema: Record<string, unknown> }
  } = {},
): Promise<ChatResult> {
  const model = options.model || settings.chatModel
  if (!model) {
    throw appError('KI_NICHT_KONFIGURIERT', 'Es ist kein Sprachmodell konfiguriert.')
  }

  const body: Record<string, unknown> = {
    model,
    temperature: options.temperature ?? settings.temperature,
    max_tokens: options.maxOutputTokens ?? settings.maxOutputTokens,
    messages: messages.map((message) => ({
      role: message.role,
      content: serializeParts(message.parts, settings.provider),
    })),
  }

  if (options.jsonSchema && settings.provider === 'openai') {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: options.jsonSchema.name,
        strict: true,
        schema: options.jsonSchema.schema,
      },
    }
  } else if (options.jsonMode) {
    // Dieser Client verwendet für alle Anbieter /v1/chat/completions. Auch
    // Ollamas OpenAI-kompatible Schnittstelle erwartet hier response_format;
    // `format` gehört ausschließlich zu Ollamas nativer /api/chat-Route.
    body.response_format = { type: 'json_object' }
  }

  const started = Date.now()
  const payload = await request<ChatCompletionResponse>(
    settings,
    '/chat/completions',
    body,
    'Die Anfrage an das Sprachmodell',
  )

  const text = payload.choices?.[0]?.message?.content?.trim() ?? ''
  if (!text) {
    throw appError('KI_FEHLER', 'Das Sprachmodell hat keine Antwort zurückgegeben.')
  }

  log.info('Chat-Anfrage abgeschlossen', {
    provider: settings.provider,
    model,
    dauerMs: Date.now() - started,
    finishReason: payload.choices?.[0]?.finish_reason ?? null,
    inputTokens: payload.usage?.prompt_tokens,
    outputTokens: payload.usage?.completion_tokens,
  })

  return {
    text,
    model: payload.model ?? model,
    inputTokens: payload.usage?.prompt_tokens,
    outputTokens: payload.usage?.completion_tokens,
    finishReason: payload.choices?.[0]?.finish_reason ?? null,
  }
}

interface EmbeddingResponse {
  data?: { embedding: number[] }[]
  error?: { message?: string }
}

export async function createEmbeddings(
  settings: AiSettings,
  inputs: string[],
  targetDimensions: number,
): Promise<number[][]> {
  if (inputs.length === 0) return []
  const configured = settings.embeddingModel
  if (!configured) {
    throw appError('KI_NICHT_KONFIGURIERT', 'Es ist kein Embedding-Modell konfiguriert.')
  }
  const model = resolveEmbeddingModel(settings.provider, configured)

  const body: Record<string, unknown> = { model, input: inputs }
  // OpenAI kann die Ausgabedimension direkt begrenzen (Matryoshka-Modelle).
  if (settings.provider === 'openai' && /text-embedding-3/.test(model)) {
    body.dimensions = targetDimensions
  }

  const payload = await request<EmbeddingResponse>(
    settings,
    '/embeddings',
    body,
    'Die Anfrage an das Embedding-Modell',
  )

  const vectors = payload.data?.map((entry) => entry.embedding) ?? []
  if (vectors.length !== inputs.length) {
    throw appError('KI_FEHLER', 'Das Embedding-Modell hat eine unerwartete Anzahl Vektoren geliefert.')
  }

  return vectors.map((vector) => fitDimensions(vector, targetDimensions))
}

/**
 * Passt einen Vektor an die feste Spaltenbreite an.
 * Auffüllen mit Nullen verändert Kosinus-Ähnlichkeiten nicht; beim Kürzen wird
 * neu normalisiert, wie es Matryoshka-Modelle vorsehen.
 */
export function fitDimensions(vector: number[], target: number): number[] {
  if (vector.length === target) return vector

  if (vector.length < target) {
    return [...vector, ...new Array(target - vector.length).fill(0)]
  }

  const truncated = vector.slice(0, target)
  const norm = Math.sqrt(truncated.reduce((sum, value) => sum + value * value, 0))
  return norm > 0 ? truncated.map((value) => value / norm) : truncated
}

async function request<T>(
  settings: AiSettings,
  path: string,
  body: unknown,
  what: string,
): Promise<T> {
  const url = `${baseUrl(settings)}${path}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), settings.timeoutMs)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted) {
      throw appError(
        'KI_FEHLER',
        `${what} hat das Zeitlimit von ${Math.round(settings.timeoutMs / 1000)} Sekunden überschritten.`,
      )
    }
    log.error('Verbindung zum KI-Anbieter fehlgeschlagen', { url, error })
    throw appError(
      'KI_FEHLER',
      `${what} konnte nicht gesendet werden. Ist die angegebene Adresse erreichbar?`,
      { cause: error },
    )
  } finally {
    clearTimeout(timeout)
  }

  const raw = await response.text()
  let parsed: unknown
  try {
    parsed = raw ? JSON.parse(raw) : {}
  } catch {
    parsed = {}
  }

  if (!response.ok) {
    const message =
      (parsed as { error?: { message?: string } })?.error?.message ??
      raw.slice(0, 300) ??
      response.statusText
    log.warn('KI-Anbieter hat einen Fehler gemeldet', { url, status: response.status, message })
    throw appError('KI_FEHLER', kiAnbieterFehlermeldung(response.status, what))
  }

  return parsed as T
}

/** Prüft Erreichbarkeit und Zugangsdaten für die Einstellungsseite. */
export async function testConnection(
  settings: AiSettings,
): Promise<{ ok: boolean; message: string; models?: string[] }> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Math.min(settings.timeoutMs, 20_000))

    const response = await fetch(`${baseUrl(settings)}/models`, {
      headers: headers(settings),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))

    if (!response.ok) {
      return {
        ok: false,
        message: `Der Anbieter antwortete mit Status ${response.status}. Bitte Adresse und Schlüssel prüfen.`,
      }
    }

    const payload = (await response.json()) as { data?: { id: string }[] }
    const models = payload.data?.map((entry) => entry.id).sort() ?? []
    let message = models.length
      ? `Verbindung erfolgreich. ${models.length} Modelle verfügbar.`
      : 'Verbindung erfolgreich.'

    if (settings.embeddingsEnabled && settings.embeddingModel.trim()) {
      try {
        const model = resolveEmbeddingModel(settings.provider, settings.embeddingModel)
        await createEmbeddings({ ...settings, embeddingModel: model }, ['Verbindungstest'], 1536)
        message += ` Embedding-Modell „${model}“ antwortet.`
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unbekannter Fehler'
        return {
          ok: false,
          message: `${message} Embedding-Test fehlgeschlagen: ${detail}`,
          models,
        }
      }
    }

    return { ok: true, message, models }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `Verbindung fehlgeschlagen: ${error.message}`
          : 'Verbindung fehlgeschlagen.',
    }
  }
}
