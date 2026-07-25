import { appError } from '../../utils/errors'
import { createLogger } from '../../utils/logger'
import type { HermesSettings } from '../settings.service'

const log = createLogger('ai:hermes')

/**
 * Optionaler Dokument-Füll-Vertrag für einen Hermes-Agent-Container.
 *
 * Hermes selbst bietet OpenAI-kompatible Chat-/Runs-APIs
 * (siehe https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server).
 * Für echte Dokumentbearbeitung kann der Container zusätzlich diesen schlanken
 * Endpunkt implementieren:
 *
 *   POST {baseUrl}/v1/document-fill
 *   Authorization: Bearer <apiKey>   (falls gesetzt)
 *
 * Request:
 * {
 *   "task": "fill_solution",
 *   "instructions": string,
 *   "fileName": string,
 *   "mimeType": string,
 *   "documentBase64": string,
 *   "meta"?: Record<string, unknown>
 * }
 *
 * Response 200:
 * {
 *   "documentBase64": string,
 *   "mimeType": string,
 *   "fileName"?: string,
 *   "summary"?: string,
 *   "model"?: string
 * }
 *
 * Fehlt der Endpunkt (404) oder ist Hermes deaktiviert, nutzt SARU den
 * lokalen Multimodal-/Dokument-Pipeline-Fallback.
 */

export interface HermesDocumentFillRequest {
  task: 'fill_solution'
  instructions: string
  fileName: string
  mimeType: string
  documentBase64: string
  meta?: Record<string, unknown>
}

export interface HermesDocumentFillResult {
  buffer: Buffer
  mimeType: string
  fileName: string
  summary: string
  model: string
}

function hermesBaseUrl(settings: HermesSettings): string {
  return settings.baseUrl.replace(/\/+$/, '')
}

function hermesHeaders(settings: HermesSettings): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`
  return headers
}

export async function tryHermesDocumentFill(
  settings: HermesSettings,
  request: HermesDocumentFillRequest,
): Promise<HermesDocumentFillResult | null> {
  if (!settings.enabled || !settings.baseUrl.trim()) return null

  const url = `${hermesBaseUrl(settings)}/v1/document-fill`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), settings.timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: hermesHeaders(settings),
      body: JSON.stringify(request),
      signal: controller.signal,
    })

    if (response.status === 404 || response.status === 501) {
      log.info('Hermes document-fill nicht implementiert – lokaler Fallback', {
        status: response.status,
      })
      return null
    }

    const raw = await response.text()
    let parsed: Record<string, unknown> = {}
    try {
      parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      parsed = {}
    }

    if (!response.ok) {
      const message =
        (parsed.error as { message?: string } | undefined)?.message ??
        raw.slice(0, 300) ??
        response.statusText
      throw appError(
        'KI_FEHLER',
        `Hermes document-fill wurde abgelehnt (${response.status}): ${message}`,
      )
    }

    const documentBase64 = String(parsed.documentBase64 ?? '')
    if (!documentBase64) {
      throw appError('KI_FEHLER', 'Hermes hat kein Dokument zurückgegeben.')
    }

    return {
      buffer: Buffer.from(documentBase64, 'base64'),
      mimeType: String(parsed.mimeType ?? request.mimeType),
      fileName: String(parsed.fileName ?? request.fileName),
      summary: String(parsed.summary ?? 'Von Hermes Agent ausgefüllte Musterlösung.'),
      model: String(parsed.model ?? 'hermes-agent'),
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw appError(
        'KI_FEHLER',
        `Hermes hat das Zeitlimit von ${Math.round(settings.timeoutMs / 1000)} Sekunden überschritten.`,
      )
    }
    if (error && typeof error === 'object' && 'code' in error) throw error
    log.warn('Hermes document-fill fehlgeschlagen – lokaler Fallback', error)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/** Prüft Erreichbarkeit des Hermes-Containers (Health oder Models). */
export async function testHermesConnection(
  settings: HermesSettings,
): Promise<{ ok: boolean; message: string }> {
  if (!settings.baseUrl.trim()) {
    return { ok: false, message: 'Bitte eine Basis-URL angeben.' }
  }

  const base = hermesBaseUrl(settings)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.min(settings.timeoutMs, 15_000))

  try {
    const health = await fetch(`${base}/health`, {
      headers: hermesHeaders(settings),
      signal: controller.signal,
    }).catch(() => null)

    if (health?.ok) {
      return { ok: true, message: 'Hermes erreichbar (Health-Check erfolgreich).' }
    }

    const models = await fetch(`${base}/v1/models`, {
      headers: hermesHeaders(settings),
      signal: controller.signal,
    })

    if (!models.ok) {
      return {
        ok: false,
        message: `Hermes antwortete mit Status ${models.status}. Bitte URL und API-Schlüssel prüfen.`,
      }
    }

    return {
      ok: true,
      message:
        'Hermes erreichbar. Für Dokumentfüllung optional POST /v1/document-fill implementieren (siehe Server-Doku).',
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `Verbindung fehlgeschlagen: ${error.message}`
          : 'Verbindung fehlgeschlagen.',
    }
  } finally {
    clearTimeout(timeout)
  }
}
