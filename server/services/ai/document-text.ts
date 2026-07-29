import { writeFile, readFile } from 'node:fs/promises'
import { oeffentlicheFehlermeldung } from '#shared/utils/public-error'
import { createLogger } from '../../utils/logger'
import {
  extractText,
  extractTextFromStorage,
  type ExtractionResult,
} from '../extraction.service'
import { extensionOf, resolveStoragePath } from '../storage.service'
import type { AiSettings } from '../settings.service'
import { chatCompletion, supportsNativePdf, type ChatPart } from './client'
import { rasterizePdf } from './rasterize'

const log = createLogger('ai:document-text')

/** Max. Seiten für Vision-OCR – Kosten/Latenz begrenzen. */
const MAX_OCR_PAGES = 8
const MAX_TEXT_LENGTH = 400_000

export type ExtractionMethod = 'text_layer' | 'vision' | 'none'

export interface EnsuredTextResult {
  status: ExtractionResult['status']
  text: string
  pageCount?: number
  error?: string
  /** Woher der Text stammt – Vision nur, wenn die Textebene leer war. */
  method: ExtractionMethod
}

export function visionExtractionAvailable(settings: AiSettings): boolean {
  if (!settings.enabled) return false
  const model = (settings.visionModel || settings.chatModel || '').trim()
  if (!model) return false
  // Vision-OCR braucht multimodale Eingabe; useVision steuert das in den Einstellungen.
  return settings.useVision || Boolean(settings.visionModel?.trim())
}

/**
 * Extrahiert durchsuchbaren Text: zuerst Textebene, bei Scans einmalig Vision/OCR.
 * Ergebnis kann persistiert und von allen Folgeschritten wiederverwendet werden.
 */
export async function ensureExtractedText(
  buffer: Buffer,
  fileName: string,
  settings: AiSettings | null,
): Promise<EnsuredTextResult> {
  const layer = await extractText(buffer, fileName)
  if (layer.text.trim()) {
    return {
      status: 'erfolgreich',
      text: layer.text,
      pageCount: layer.pageCount,
      method: 'text_layer',
    }
  }

  const ext = extensionOf(fileName)
  if (ext !== 'pdf' || !settings || !visionExtractionAvailable(settings)) {
    return {
      status: layer.status,
      text: '',
      pageCount: layer.pageCount,
      error: layer.error,
      method: 'none',
    }
  }

  try {
    const vision = await extractTextViaVision(buffer, fileName, settings)
    if (vision.text.trim()) {
      return {
        status: 'erfolgreich',
        text: truncate(vision.text),
        pageCount: vision.pageCount ?? layer.pageCount,
        method: 'vision',
      }
    }
    return {
      status: layer.status === 'fehlgeschlagen' ? 'fehlgeschlagen' : 'nicht_unterstuetzt',
      text: '',
      pageCount: layer.pageCount ?? vision.pageCount,
      error:
        vision.error ||
        layer.error ||
        'Das PDF enthält keine Textebene und die Vision-Extraktion lieferte keinen Text.',
      method: 'none',
    }
  } catch (error) {
    log.warn('Vision-Textextraktion fehlgeschlagen', { fileName, error })
    return {
      status: layer.status === 'fehlgeschlagen' ? 'fehlgeschlagen' : 'nicht_unterstuetzt',
      text: '',
      pageCount: layer.pageCount,
      error: oeffentlicheFehlermeldung(
        error,
        'Die Vision-Textextraktion ist fehlgeschlagen.',
      ),
      method: 'none',
    }
  }
}

/** Wie `ensureExtractedText`, liest die Datei aus dem Speicher. */
export async function ensureExtractedTextFromStorage(
  storageKey: string,
  fileName: string,
  settings: AiSettings | null,
): Promise<EnsuredTextResult> {
  try {
    const buffer = await readFile(resolveStoragePath(storageKey))
    return await ensureExtractedText(buffer, fileName, settings)
  } catch (error) {
    log.warn('Textextraktion aus Speicher fehlgeschlagen', { storageKey, error })
    // Fallback ohne Vision, damit der Status konsistent bleibt.
    const fallback = await extractTextFromStorage(storageKey, fileName)
    return { ...fallback, method: fallback.text.trim() ? 'text_layer' : 'none' }
  }
}

/**
 * Speichert den bereits extrahierten Volltext neben der Staging-Datei,
 * damit Commit denselben Extrakt nutzen kann (kein zweites Vision/OCR).
 */
export async function storeExtractedTextSidecar(
  stagingPath: string,
  text: string,
): Promise<string> {
  const key = `${stagingPath}.extracted.txt`
  await writeFile(resolveStoragePath(key), text, { encoding: 'utf8', mode: 0o640 })
  return key
}

export async function readExtractedTextSidecar(
  extractedTextKey: string | null | undefined,
): Promise<string | null> {
  if (!extractedTextKey) return null
  try {
    const text = await readFile(resolveStoragePath(extractedTextKey), 'utf8')
    return text.trim() ? text : null
  } catch {
    return null
  }
}

async function extractTextViaVision(
  buffer: Buffer,
  fileName: string,
  settings: AiSettings,
): Promise<{ text: string; pageCount?: number; error?: string }> {
  const model = (settings.visionModel || settings.chatModel).trim()
  const parts: ChatPart[] = [
    {
      type: 'text',
      text: `Du bist eine OCR-/Texterkennung für deutschsprachige Unterrichtsmaterialien.
Extrahiere den gesamten lesbaren Text aus dem Dokument möglichst vollständig und in Lesereihenfolge.
Antworte ausschließlich mit dem erkannten Fließtext – kein Markdown, keine Erklärungen, keine Meta-Kommentare.
Wenn etwas unleserlich ist, überspringe es still.`,
    },
  ]

  let pageCount: number | undefined

  if (supportsNativePdf(settings.provider)) {
    parts.push({
      type: 'file',
      mimeType: 'application/pdf',
      base64: buffer.toString('base64'),
      fileName,
    })
  } else {
    const pages = await rasterizePdf(buffer, { maxPages: MAX_OCR_PAGES, scale: 1.8 })
    if (!pages.length) {
      return {
        text: '',
        error: 'PDF-Seiten konnten nicht für die Vision-Extraktion gerendert werden.',
      }
    }
    pageCount = pages.length
    for (const page of pages) {
      parts.push({ type: 'image', mimeType: page.mimeType, base64: page.base64 })
    }
  }

  const result = await chatCompletion(settings, [{ role: 'user', parts }], {
    model,
    temperature: 0,
    maxOutputTokens: Math.min(settings.maxOutputTokens || 4000, 8000),
  })

  return { text: result.text.trim(), pageCount }
}

function truncate(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').normalize('NFC').trim()
  return normalized.length > MAX_TEXT_LENGTH
    ? normalized.slice(0, MAX_TEXT_LENGTH)
    : normalized
}
