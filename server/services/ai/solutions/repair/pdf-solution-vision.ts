import { extractJsonObject } from '../../../../utils/json-parse'
import type { AiSettings } from '../../../settings.service'
import { chatCompletion, supportsNativePdf, type ChatPart } from '../../client'
import type { SolutionBBox } from '../../document-fill'
import { rasterizePdf } from '../../rasterize'

export interface PdfSolutionQualityResult {
  status: 'passed' | 'warning' | 'unavailable'
  issues: string[]
  checkedAt: string
  model?: string
}

function qualityPrompt(
  expectedOverlays: Array<{ text: string; page: number; bbox: SolutionBBox }>,
): string {
  const inventory = expectedOverlays.map((entry, index) => ({
    index: index + 1,
    text: entry.text,
    page: entry.page,
    bbox: entry.bbox,
  }))
  const inventoryRule = inventory.length > 0
    ? [
        `- Erwartet werden exakt ${inventory.length} Overlays. Prüfe jedes gegen dieses verbindliche Inventar: ${JSON.stringify(inventory)}`,
        '- bbox ist normalisiert (0–1) und hat den Ursprung oben links. Fehlt ein Inventareintrag, liegt er außerhalb seiner bbox oder steht dort ein anderer Lösungstext, ist verdict=warning.',
      ]
    : [
        '- Es liegt kein geometrisches Overlay-Inventar vor; prüfe Lösungsseiten und Anhänge allgemein auf Lesbarkeit und Vollständigkeit.',
      ]
  return [
    'Du prüfst die visuelle Qualität einer automatisch erzeugten Musterlösung.',
    'Du erhältst zuerst das Original-Arbeitsblatt und anschließend die gerenderte Musterlösung.',
    'Prüfe ausschließlich sichtbar und konservativ:',
    '- Antworten befinden sich in den vorgesehenen Bereichen und überdecken keine Aufgaben.',
    '- Tabellenantworten stehen in der passenden Zelle.',
    '- Bei Ankreuzaufgaben ist pro Aussage höchstens eine Option markiert.',
    '- Es fehlen keine offensichtlich vorgesehenen Einträge.',
    '- Der Lösungstext ist lesbar und nicht abgeschnitten.',
    ...inventoryRule,
    'Fachliche Richtigkeit sollst du nur beanstanden, wenn sie unmittelbar offensichtlich ist.',
    'Antworte ausschließlich als JSON: {"verdict":"pass|warning","issues":["kurzer konkreter Hinweis"]}.',
    'Nutze verdict="warning" nur bei einem sichtbaren, konkreten Problem. Ohne sichtbares Problem: pass mit leerem issues-Array.',
  ].join('\n')
}

export function parsePdfSolutionQualityResponse(
  raw: string,
  model?: string,
): PdfSolutionQualityResult {
  const parsed = extractJsonObject(raw)
  if (!parsed || (parsed.verdict !== 'pass' && parsed.verdict !== 'warning')) {
    return {
      status: 'unavailable',
      issues: ['Die Antwort der visuellen Qualitätsprüfung war nicht auswertbar.'],
      checkedAt: new Date().toISOString(),
      model,
    }
  }
  const issues = Array.isArray(parsed?.issues)
    ? parsed.issues
        .filter((issue): issue is string => typeof issue === 'string')
        .map((issue) => issue.trim().slice(0, 500))
        .filter(Boolean)
        .slice(0, 12)
    : []
  const warned = parsed.verdict === 'warning' || issues.length > 0
  return {
    status: warned ? 'warning' : 'passed',
    issues,
    checkedAt: new Date().toISOString(),
    model,
  }
}

/**
 * Zweite Vision-Stufe nach dem Rendern. Ein Fehler des Prüfers blockiert die
 * Musterlösung nicht; er wird als „unavailable“ dokumentiert statt still zu
 * einem fehlerhaften Pass-Ergebnis zu werden.
 */
export async function verifyPdfSolutionViaVision(args: {
  source: Buffer
  sourceFileName: string
  rendered: Buffer
  renderedFileName: string
  settings: AiSettings
  model: string
  expectedOverlays?: Array<{ text: string; page: number; bbox: SolutionBBox }>
}): Promise<PdfSolutionQualityResult> {
  const parts: ChatPart[] = [
    { type: 'text', text: qualityPrompt(args.expectedOverlays ?? []) },
  ]
  if (supportsNativePdf(args.settings.provider)) {
    parts.push(
      {
        type: 'file',
        mimeType: 'application/pdf',
        base64: args.source.toString('base64'),
        fileName: `original-${args.sourceFileName}`,
      },
      {
        type: 'file',
        mimeType: 'application/pdf',
        base64: args.rendered.toString('base64'),
        fileName: `musterloesung-${args.renderedFileName}`,
      },
    )
  } else {
    const [sourcePages, renderedPages] = await Promise.all([
      rasterizePdf(args.source, { maxPages: 4, scale: 1.35 }),
      rasterizePdf(args.rendered, { maxPages: 4, scale: 1.35 }),
    ])
    const pairCount = Math.min(sourcePages.length, renderedPages.length)
    for (let index = 0; index < pairCount; index++) {
      parts.push(
        { type: 'text', text: `Original, Seite ${index + 1}:` },
        {
          type: 'image',
          mimeType: sourcePages[index]!.mimeType,
          base64: sourcePages[index]!.base64,
        },
        { type: 'text', text: `Musterlösung, Seite ${index + 1}:` },
        {
          type: 'image',
          mimeType: renderedPages[index]!.mimeType,
          base64: renderedPages[index]!.base64,
        },
      )
    }
    if (pairCount === 0) {
      return {
        status: 'unavailable',
        issues: ['Das PDF konnte nicht für die visuelle Qualitätsprüfung gerendert werden.'],
        checkedAt: new Date().toISOString(),
      }
    }
  }

  try {
    const completion = await chatCompletion(
      args.settings,
      [{ role: 'user', parts }],
      { model: args.model, temperature: 0, maxOutputTokens: 1200, jsonMode: true },
    )
    return parsePdfSolutionQualityResponse(completion.text, completion.model)
  } catch (error) {
    return {
      status: 'unavailable',
      issues: [
        error instanceof Error
          ? `Visuelle Qualitätsprüfung nicht verfügbar: ${error.message}`
          : 'Visuelle Qualitätsprüfung nicht verfügbar.',
      ],
      checkedAt: new Date().toISOString(),
    }
  }
}
