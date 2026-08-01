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

/**
 * Schreibt Diagramm-Markierungen als Text in passende Textboxen / als
 * sequenzielle Labels. 2e-min: keine Vektorgrafik, nur lesbare Beschriftung.
 */
export function applyDiagramMarksToDocx(
  source: Buffer,
  solution: StructuredSolution,
  diagramTargets: AnswerTarget[] = [],
): { buffer: Buffer; filled: number } {
  const marks = solution.diagramMarks ?? []
  if (marks.length === 0 && diagramTargets.length === 0) {
    return { buffer: source, filled: 0 }
  }

  const files = unzipSync(new Uint8Array(source))
  const docEntry = files['word/document.xml']
  if (!docEntry) return { buffer: source, filled: 0 }

  let xml = strFromU8(docEntry)

  // Map marks → synthetic answers with targetIds (txbx-* or shape-*)
  const answers = marks.map((mark, i) => {
    const text = markToText(mark)
    const target =
      diagramTargets.find((t) => t.id === mark.targetId) ??
      diagramTargets[i]
    return {
      id: String(i + 1),
      label: target?.id ?? mark.targetId,
      answer: text,
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

  // Falls Marks auf Shape-IDs zeigen: sequenziell in leere Textboxen schreiben.
  const sequentialFallback = marks.map((m) => markToText(m))
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

  // Zusätzlich: kurze Labels als Absätze vor </w:body>, falls nichts befüllt.
  let filled = result.filled
  if (filled === 0 && marks.length > 0) {
    const paras = marks
      .map((m, i) => {
        const text = markToText(m)
        return `<w:p><w:r><w:rPr><w:color w:val="1F4E9B"/><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(`Diagramm ${i + 1}: ${text}`)}</w:t></w:r></w:p>`
      })
      .join('')
    xml = xml.replace(/<\/w:body>/i, `${paras}</w:body>`)
    filled = marks.length
  }

  files['word/document.xml'] = strToU8(xml)
  return {
    buffer: Buffer.from(zipSync(files, { level: 6 })),
    filled,
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
