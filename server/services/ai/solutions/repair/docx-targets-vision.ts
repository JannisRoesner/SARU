import { extractJsonObject } from '../../../../utils/json-parse'
import type { AiSettings } from '../../../settings.service'
import { chatCompletion, type ChatPart } from '../../client'
import { visionExtractionAvailable } from '../../document-text'
import type { SolutionBBox } from '../../document-fill'
import { rasterizePdf } from '../../rasterize'
import type { AnswerTarget, AnswerTargetKind } from '../types'

const MAX_VISION_PAGES = 2

export function buildDocxTargetsVisionPrompt(existingCount: number): string {
  return [
    'Du siehst ein gescanntes / gerendertes Arbeitsblatt (Word → PDF).',
    'Finde Antwortfelder: leere Kreise, Rechtecke, Antwortlinien und Textboxen.',
    existingCount > 0
      ? `Es gibt bereits ${existingCount} native Ziele – ergänze nur fehlende oder unsichere.`
      : 'Es gibt noch keine sicheren nativen Ziele.',
    '',
    'Antworte ausschließlich als JSON:',
    '{"targets":[{"kind":"oval|box|line|textbox","bbox":{"x":0.1,"y":0.2,"w":0.15,"h":0.1},"nearbyText":"…","label":"optional"}]}',
    '',
    'Regeln:',
    '- bbox normalisiert 0–1, Ursprung oben links',
    '- Nur leere / ausfüllbare Felder, keine Überschriften oder gefüllte Kästen',
    '- Maximal 40 Targets',
    '- Wenn nichts erkennbar: {"targets":[]}',
  ].join('\n')
}

function mapKind(raw: string): AnswerTargetKind {
  const k = raw.toLowerCase()
  if (k === 'oval' || k === 'circle' || k === 'shape_oval') return 'shape_oval'
  if (k === 'box' || k === 'rect' || k === 'shape_box') return 'shape_box'
  if (k === 'line' || k === 'answer_line') return 'answer_line'
  if (k === 'textbox' || k === 'text_field') return 'text_field'
  return 'answer_line'
}

function parseBBox(raw: unknown): SolutionBBox | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const x = Number(row.x)
  const y = Number(row.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
    w: Number.isFinite(Number(row.w)) ? Math.min(1, Math.max(0.01, Number(row.w))) : 0.1,
    h: Number.isFinite(Number(row.h)) ? Math.min(1, Math.max(0.01, Number(row.h))) : 0.05,
  }
}

/** Parst Vision-Antwort zu AnswerTargets. */
export function parseDocxTargetsVisionResponse(raw: string, page = 1): AnswerTarget[] {
  const parsed = extractJsonObject(raw)
  if (!parsed || !Array.isArray(parsed.targets)) return []
  const out: AnswerTarget[] = []
  for (let i = 0; i < parsed.targets.length && i < 40; i++) {
    const row = parsed.targets[i]
    if (!row || typeof row !== 'object') continue
    const rec = row as Record<string, unknown>
    const bbox = parseBBox(rec.bbox)
    if (!bbox) continue
    out.push({
      id: `vision-${i}`,
      kind: mapKind(String(rec.kind ?? 'box')),
      page,
      bbox,
      leftText: typeof rec.nearbyText === 'string' ? rec.nearbyText.slice(0, 80) : undefined,
      nativeRef: typeof rec.label === 'string' ? rec.label : null,
      source: 'vision',
    })
  }
  return out
}

/**
 * Vision-Fallback: findet Antwortfelder auf gerenderten DOCX→PDF-Seiten.
 */
export async function repairDocxTargetsViaVision(args: {
  /** Bereits als PDF gerenderter Buffer (Office→PDF). */
  pdfBuffer: Buffer
  settings: AiSettings
  instruction?: string
  existingTargets: AnswerTarget[]
  page?: number
}): Promise<AnswerTarget[]> {
  if (!visionExtractionAvailable(args.settings)) return []

  const pages = await rasterizePdf(args.pdfBuffer, {
    maxPages: MAX_VISION_PAGES,
    page: args.page,
    scale: 1.4,
  })
  if (pages.length === 0) return []

  const parts: ChatPart[] = [
    { type: 'text', text: buildDocxTargetsVisionPrompt(args.existingTargets.length) },
  ]
  if (args.instruction?.trim()) {
    parts.push({
      type: 'text',
      text: `Aufgabenhinweis: ${args.instruction.trim().slice(0, 240)}`,
    })
  }
  for (const page of pages) {
    parts.push({
      type: 'image',
      mimeType: page.mimeType,
      dataBase64: page.base64,
    })
  }

  const model =
    args.settings.visionModel?.trim() ||
    args.settings.chatModel?.trim() ||
    ''
  if (!model) return []

  const completion = await chatCompletion(
    args.settings,
    [{ role: 'user', parts }],
    { model, maxOutputTokens: Math.min(2048, args.settings.maxOutputTokens ?? 2048) },
  )
  return parseDocxTargetsVisionResponse(completion.text, args.page ?? 1)
}
