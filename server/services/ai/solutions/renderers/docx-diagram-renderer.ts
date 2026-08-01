import type { DiagramMark, StructuredSolution } from '../../document-fill'
import { fillDocxTextboxes } from '../../document-fill'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { AnswerTarget } from '../types'

function chromosomeLabel(mark: Extract<DiagramMark, { kind: 'chromosome' }>): string {
  if (mark.form === 'two_chromatid') {
    return mark.count <= 1 ? '||' : `${mark.count}× ||`
  }
  return mark.count <= 1 ? '|' : `${mark.count}× |`
}

function markToText(mark: DiagramMark): string {
  if (mark.kind === 'label' || mark.kind === 'arrow_label') return mark.text
  return chromosomeLabel(mark)
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function vmlTextboxInner(text: string): string {
  return `<v:textbox inset="2pt,2pt,2pt,2pt" style="mso-fit-shape-to-text:t"><w:txbxContent><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:color w:val="1F4E9B"/><w:b/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:txbxContent></v:textbox>`
}

/**
 * Schreibt Text in leere VML-Ovale/-Rechtecke (self-closing → paired + textbox).
 * nativeRef der Targets ist typischerweise die VML-id (_x0000_s…).
 */
export function fillVmlShapesWithLabels(
  xml: string,
  items: Array<{ shapeId: string; text: string }>,
): { xml: string; filled: number } {
  if (items.length === 0) return { xml, filled: 0 }
  let next = xml
  let filled = 0
  const used = new Set<string>()

  for (const item of items) {
    const shapeId = item.shapeId.trim()
    if (!shapeId || used.has(shapeId) || !item.text.trim()) continue
    const escapedId = shapeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const selfClosing = new RegExp(
      `<(v:(?:oval|rect|roundrect|shape))\\b([^>]*\\bid="${escapedId}"[^>]*)/>`,
      'i',
    )
    const paired = new RegExp(
      `<(v:(?:oval|rect|roundrect|shape))\\b([^>]*\\bid="${escapedId}"[^>]*)>([\\s\\S]*?)<\\/\\1>`,
      'i',
    )

    if (selfClosing.test(next)) {
      next = next.replace(selfClosing, (_full, tag: string, attrs: string) => {
        filled += 1
        used.add(shapeId)
        return `<${tag}${attrs}>${vmlTextboxInner(item.text.trim())}</${tag}>`
      })
      continue
    }

    if (paired.test(next)) {
      next = next.replace(paired, (full, tag: string, attrs: string, inner: string) => {
        if (/<w:t\b/i.test(inner) && /<w:t[^>]*>\s*[^<\s]/i.test(inner)) {
          return full
        }
        filled += 1
        used.add(shapeId)
        const withoutOldTextbox = inner.replace(/<v:textbox\b[\s\S]*?<\/v:textbox>/gi, '')
        return `<${tag}${attrs}>${withoutOldTextbox}${vmlTextboxInner(item.text.trim())}</${tag}>`
      })
    }
  }

  return { xml: next, filled }
}

function resolveShapeNativeId(
  mark: DiagramMark,
  diagramTargets: AnswerTarget[],
  index: number,
): string | null {
  const target =
    diagramTargets.find((t) => t.id === mark.targetId) ?? diagramTargets[index]
  if (!target) return null
  const ref = String(target.nativeRef ?? '').trim()
  if (ref && !ref.startsWith('txbx-') && !ref.startsWith('shape-')) return ref
  // Fallback: manchmal ist nativeRef die shape-id selbst.
  if (ref.startsWith('shape-')) {
    const byId = diagramTargets.find((t) => t.id === ref)
    const nested = String(byId?.nativeRef ?? '').trim()
    if (nested && !nested.startsWith('txbx-') && !nested.startsWith('shape-')) return nested
  }
  return null
}

/**
 * Schreibt Diagramm-Markierungen als Text in passende Textboxen / VML-Shapes.
 */
export function applyDiagramMarksToDocx(
  source: Buffer,
  solution: StructuredSolution,
  diagramTargets: AnswerTarget[] = [],
): { buffer: Buffer; filled: number } {
  const marks = solution.diagramMarks ?? []
  // Auch answers mit targetId shape-* / txbx-* als Labels nutzen, falls Marks fehlen.
  const answerMarks: DiagramMark[] =
    marks.length > 0
      ? marks
      : solution.answers
          .filter(
            (a) =>
              a.answer.trim() &&
              (a.targetId?.startsWith('shape-') ||
                a.targetId?.startsWith('txbx-') ||
                /^shape-\d+$/i.test(a.label) ||
                /^txbx-\d+$/i.test(a.label)),
          )
          .map((a) => ({
            kind: 'label' as const,
            text: a.answer.trim(),
            targetId: a.targetId?.startsWith('shape-') || a.targetId?.startsWith('txbx-')
              ? a.targetId
              : a.label,
          }))

  if (answerMarks.length === 0 && diagramTargets.length === 0) {
    return { buffer: source, filled: 0 }
  }

  const files = unzipSync(new Uint8Array(source))
  const docEntry = files['word/document.xml']
  if (!docEntry) return { buffer: source, filled: 0 }

  let xml = strFromU8(docEntry)
  let filled = 0

  const vmlItems: Array<{ shapeId: string; text: string }> = []
  for (let i = 0; i < answerMarks.length; i++) {
    const mark = answerMarks[i]!
    const shapeId = resolveShapeNativeId(mark, diagramTargets, i)
    if (shapeId) vmlItems.push({ shapeId, text: markToText(mark) })
  }
  const vml = fillVmlShapesWithLabels(xml, vmlItems)
  xml = vml.xml
  filled += vml.filled

  const answers = answerMarks.map((mark, i) => {
    const target =
      diagramTargets.find((t) => t.id === mark.targetId) ?? diagramTargets[i]
    return {
      id: String(i + 1),
      label: target?.id ?? mark.targetId,
      answer: markToText(mark),
      targetId: target?.nativeRef?.startsWith('txbx-')
        ? target.nativeRef
        : target?.id?.startsWith('txbx-')
          ? target.id
          : mark.targetId.startsWith('txbx-')
            ? mark.targetId
            : null,
      blankIndex: null as number | null,
      fieldType: 'luecke' as const,
    }
  })

  const sequentialFallback = answerMarks.map((m) => markToText(m))
  const enriched: StructuredSolution = {
    ...solution,
    answers: [
      ...answers,
      ...sequentialFallback
        .filter((_, i) => !answers[i]?.targetId)
        .map((text, i) => ({
          id: `diag-seq-${i}`,
          label: `Diagramm ${i + 1}`,
          answer: text,
          blankIndex: null,
          fieldType: 'luecke' as const,
        })),
    ],
  }

  const result = fillDocxTextboxes(xml, enriched)
  xml = result.xml
  filled += result.filled

  files['word/document.xml'] = strToU8(xml)
  return {
    buffer: Buffer.from(zipSync(files, { level: 6 })),
    filled,
  }
}
