import { extractJsonObject } from '../../../../utils/json-parse'
import type { AiSettings } from '../../../settings.service'
import { chatCompletion, supportsNativePdf, type ChatPart } from '../../client'
import { visionExtractionAvailable } from '../../document-text'
import { rasterizePdf } from '../../rasterize'
import { candidateBankFromWords } from '../candidate-bank'
import type { CandidateBank } from '../types'

const MAX_VISION_PAGES = 2

export function buildCandidateBankVisionPrompt(
  blankCount: number,
  instruction?: string,
): string {
  const lines = [
    'Du siehst ein Arbeitsblatt mit Lückentext-Aufgabe.',
    'Extrahiere NUR die Wortliste / Wörterbank / Begriffsliste zum Einsetzen in die Lücken.',
    '',
  ]

  if (instruction?.trim()) {
    lines.push(`Hinweis aus der Aufgabenstellung: ${instruction.trim().slice(0, 240)}`, '')
  }
  if (blankCount > 0) {
    lines.push(
      `Es gibt ${blankCount} Lücken – die Wortliste enthält vermutlich ${blankCount} Begriffe.`,
      '',
    )
  }

  lines.push(
    'Antworte ausschließlich als JSON:',
    '{"words": ["Begriff1", "Begriff2"]}',
    '',
    'Regeln:',
    '- Nur Begriffe aus der sichtbaren Wortliste, keine Satzlösungen für einzelne Lücken',
    '- Reihenfolge wie im Dokument (links nach rechts, oben nach unten)',
    '- Keine Duplikate',
    '- Wenn keine Wortliste erkennbar: {"words": []}',
  )

  return lines.join('\n')
}

/** Parst die Modellantwort eines Vision-Wortlisten-Repairs. */
export function parseCandidateBankVisionResponse(
  raw: string,
  blankCount = 0,
): CandidateBank | null {
  const parsed = extractJsonObject(raw)
  if (!parsed || !Array.isArray(parsed.words)) return null
  const words = parsed.words.filter(
    (w): w is string => typeof w === 'string' && w.trim().length >= 2,
  )
  return candidateBankFromWords(words, blankCount, 'vision')
}

/**
 * Gezielter Vision-Aufruf: nur Wortliste aus Scan-PDF extrahieren.
 * Günstiger und zuverlässiger als Voll-OCR für Lückentexte.
 */
export async function repairCandidateBankViaVision(args: {
  buffer: Buffer
  fileName: string
  settings: AiSettings
  blankCount: number
  instruction?: string
  /** 1-basierte Seite mit der Wortliste (Standard: erste Seiten). */
  page?: number
}): Promise<CandidateBank | null> {
  if (!visionExtractionAvailable(args.settings)) return null

  const model = (args.settings.visionModel || args.settings.chatModel).trim()
  const parts: ChatPart[] = [
    {
      type: 'text',
      text: buildCandidateBankVisionPrompt(args.blankCount, args.instruction),
    },
  ]

  if (supportsNativePdf(args.settings.provider)) {
    parts.push({
      type: 'file',
      mimeType: 'application/pdf',
      base64: args.buffer.toString('base64'),
      fileName: args.fileName,
    })
  } else {
    const pages = await rasterizePdf(args.buffer, {
      maxPages: MAX_VISION_PAGES,
      page: args.page && args.page > 0 ? args.page : undefined,
      scale: 1.85,
    })
    if (!pages.length) return null
    for (const page of pages) {
      parts.push({ type: 'image', mimeType: page.mimeType, base64: page.base64 })
    }
  }

  const result = await chatCompletion(args.settings, [{ role: 'user', parts }], {
    model,
    temperature: 0,
    maxOutputTokens: 1024,
  })

  return parseCandidateBankVisionResponse(result.text, args.blankCount)
}
