import type { SolutionBBox } from '../document-fill'
import { decodeXmlEntities, listDocxXmlParts, pageForDocxPart, readDocxPart } from './docx-parts'
import type { AnswerTarget, AnswerTargetKind, ShapeBlock, ShapeBlockKind } from './types'

export interface DocxShapeTarget {
  id: string
  kind: 'line' | 'box' | 'oval' | 'shape'
  page: number
  bbox: SolutionBBox
  nativeRef: {
    xmlPart: string
    shapeId?: string
    anchorParagraphIndex?: number
  }
  anchorText?: string
}

/** Mindestbreite in pt – kleinere Linien/Shapes gelten als Dekoration. */
const MIN_SHAPE_PT = 20
/** Word VML style often uses pt or EMUs (914400 EMU = 1 inch). */
const EMU_PER_PT = 12700

function parseLengthToPt(raw: string | undefined): number | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const pt = trimmed.match(/^([\d.]+)\s*pt$/i)
  if (pt) return Number(pt[1])
  const emu = trimmed.match(/^([\d.]+)(?:emu)?$/i)
  if (emu) {
    const n = Number(emu[1])
    if (n > 1000) return n / EMU_PER_PT
    return n
  }
  const bare = Number(trimmed)
  return Number.isFinite(bare) ? bare : null
}

function parseStyleMap(style: string | undefined): Record<string, string> {
  if (!style) return {}
  const out: Record<string, string> = {}
  for (const part of style.split(';')) {
    const [k, v] = part.split(':').map((s) => s.trim())
    if (k && v) out[k.toLowerCase()] = v
  }
  return out
}

function styleToBBox(style: Record<string, string>, fallbackIndex: number): SolutionBBox {
  const widthPt = parseLengthToPt(style.width) ?? 40
  const heightPt = parseLengthToPt(style.height) ?? (style.width ? 4 : 40)
  // Approximate page as A4 595×842 pt; left/top may be missing for inline shapes.
  const leftPt =
    parseLengthToPt(style.left) ??
    parseLengthToPt(style['margin-left']) ??
    40 + (fallbackIndex % 5) * 20
  const topPt =
    parseLengthToPt(style.top) ??
    parseLengthToPt(style['margin-top']) ??
    100 + Math.floor(fallbackIndex / 5) * 30
  return {
    x: Math.min(0.95, Math.max(0, leftPt / 595)),
    y: Math.min(0.95, Math.max(0, topPt / 842)),
    w: Math.min(0.9, Math.max(0.02, widthPt / 595)),
    h: Math.min(0.5, Math.max(0.01, heightPt / 842)),
  }
}

function hasVisibleText(inner: string): boolean {
  const texts = [...inner.matchAll(/<v:textbox[\s\S]*?<w:t[^>]*>([\s\S]*?)<\/w:t>/gi)]
    .map((m) => decodeXmlEntities(m[1] ?? '').trim())
    .filter(Boolean)
  if (texts.length > 0) return true
  const plain = [...inner.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((m) => decodeXmlEntities(m[1] ?? '').trim())
    .join('')
  return plain.length > 0
}

function classifyTag(tag: string, style: Record<string, string>): DocxShapeTarget['kind'] {
  const t = tag.toLowerCase()
  if (t === 'v:line' || t.endsWith(':line')) return 'line'
  if (t === 'v:oval' || t.endsWith(':oval')) return 'oval'
  if (t === 'v:rect' || t === 'v:roundrect' || t.endsWith(':rect')) return 'box'
  // v:shape – distinguish by path/type hints
  const type = (style.type ?? '').toLowerCase()
  if (type.includes('oval') || type.includes('ellipse')) return 'oval'
  if (type.includes('rect')) return 'box'
  if (type.includes('line')) return 'line'
  return 'shape'
}

function isAnswerCandidate(kind: DocxShapeTarget['kind'], style: Record<string, string>, inner: string): boolean {
  const widthPt = parseLengthToPt(style.width) ?? 0
  const heightPt = parseLengthToPt(style.height) ?? 0
  if (kind === 'line') {
    return widthPt >= MIN_SHAPE_PT || heightPt >= 1
  }
  // Decorations: tiny shapes
  if (widthPt > 0 && widthPt < MIN_SHAPE_PT && heightPt > 0 && heightPt < MIN_SHAPE_PT) {
    return false
  }
  // Filled shapes with existing text are labels, not answer targets
  if (hasVisibleText(inner)) return false
  return true
}

function toAnswerKind(kind: DocxShapeTarget['kind']): AnswerTargetKind {
  if (kind === 'line') return 'answer_line'
  if (kind === 'oval') return 'shape_oval'
  if (kind === 'box') return 'shape_box'
  return 'answer_line'
}

function toShapeBlockKind(kind: DocxShapeTarget['kind']): ShapeBlockKind {
  return kind
}

function extractAnchorText(xml: string, offset: number): string {
  const before = xml.slice(Math.max(0, offset - 400), offset)
  const texts = [...before.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((m) => decodeXmlEntities(m[1] ?? ''))
    .join('')
  return texts.replace(/\s+/g, ' ').trim().slice(-80)
}

function parseVmlFromXml(xml: string, part: string, page: number, idOffset: number): DocxShapeTarget[] {
  const targets: DocxShapeTarget[] = []
  // Match self-closing or paired VML elements
  const tagRe =
    /<(v:(?:line|oval|rect|roundrect|shape))\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi
  let match: RegExpExecArray | null
  let localIndex = 0
  while ((match = tagRe.exec(xml)) != null) {
    const tag = match[1]!
    const attrs = match[2] ?? ''
    const inner = match[3] ?? ''
    const styleAttr = attrs.match(/\bstyle\s*=\s*"([^"]*)"/i)?.[1]
    const style = parseStyleMap(styleAttr)
    const kind = classifyTag(tag, style)
    if (!isAnswerCandidate(kind, style, inner)) {
      localIndex += 1
      continue
    }
    const shapeId =
      attrs.match(/\bid\s*=\s*"([^"]+)"/i)?.[1] ??
      attrs.match(/\bo:spid\s*=\s*"([^"]+)"/i)?.[1]
    const id = `shape-${idOffset + targets.length}`
    targets.push({
      id,
      kind,
      page,
      bbox: styleToBBox(style, localIndex),
      nativeRef: {
        xmlPart: part,
        shapeId,
        anchorParagraphIndex: localIndex,
      },
      anchorText: extractAnchorText(xml, match.index),
    })
    localIndex += 1
  }
  return targets
}

/**
 * Findet VML-Antwortshapes (Linien, Ovale, Rechtecke) in DOCX-Parts.
 * DrawingML-Pfade können später ergänzt werden – gleiche Zielstruktur.
 */
export function analyzeDocxShapes(source: Buffer): DocxShapeTarget[] {
  const parts = listDocxXmlParts(source)
  const all: DocxShapeTarget[] = []
  for (const part of parts) {
    const xml = readDocxPart(source, part)
    if (!xml) continue
    if (!/<v:(?:line|oval|rect|roundrect|shape)\b/i.test(xml)) continue
    const page = pageForDocxPart(part)
    all.push(...parseVmlFromXml(xml, part, page, all.length))
  }
  return all
}

/** Konvertiert Shape-Targets in AnswerTargets für die Pipeline. */
export function docxShapesToAnswerTargets(shapes: DocxShapeTarget[]): AnswerTarget[] {
  return shapes.map((s) => ({
    id: s.id,
    kind: toAnswerKind(s.kind),
    page: s.page,
    bbox: s.bbox,
    nativeRef: s.nativeRef.shapeId ?? s.id,
    leftText: s.anchorText ?? undefined,
    source: 'native' as const,
  }))
}

/** Konvertiert Shape-Targets in ShapeBlocks für DocumentModel. */
export function docxShapesToShapeBlocks(shapes: DocxShapeTarget[]): ShapeBlock[] {
  return shapes.map((s) => ({
    id: s.id,
    page: s.page,
    kind: toShapeBlockKind(s.kind),
    bbox: s.bbox,
    nativeRef: s.nativeRef.shapeId ?? s.id,
    anchorText: s.anchorText ?? null,
  }))
}
