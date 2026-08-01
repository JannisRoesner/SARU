import {
  analyzeDocxShapes,
  docxShapesToAnswerTargets,
  docxShapesToShapeBlocks,
} from './docx-shapes'
import {
  decodeXmlEntities,
  listDocxXmlParts,
  pageForDocxPart,
  readDocxPart,
} from './docx-parts'
import type { AnswerTarget, NativeField, ShapeBlock } from './types'

export interface DocxAnalysis {
  nativeFields: NativeField[]
  targets: AnswerTarget[]
  shapes: ShapeBlock[]
  fullText: string
}

function analyzeDocxTableCells(xml: string, page: number, idOffset: number): AnswerTarget[] {
  const targets: AnswerTarget[] = []
  const rows = [...xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)]
  let rowIndex = 0
  for (const row of rows) {
    const cells = [...row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)]
    let colIndex = 0
    for (const cell of cells) {
      const cellXml = cell[0]
      const text = [...cellXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
        .map((t) => decodeXmlEntities(t[1] ?? ''))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
      const hasUnderlineBlank =
        /<w:u[\s/>]/.test(cellXml) &&
        [...cellXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].some((t) =>
          /^[\s\u00a0_]+$/.test(decodeXmlEntities(t[1] ?? '')),
        )
      // Leere oder nur-Leerzeichen-Zellen ohne Unterstreichungs-Lücke.
      if ((text.length === 0 || /^[\s\u00a0.·•_-]*$/.test(text)) && !hasUnderlineBlank) {
        const cellRef = `${rowIndex}:${colIndex}`
        const id = `tc-${idOffset + targets.length}`
        targets.push({
          id,
          kind: 'table_cell',
          page,
          cellRef,
          nativeRef: cellRef,
          source: 'native',
        })
      }
      colIndex += 1
    }
    rowIndex += 1
  }
  return targets
}

function analyzePartXml(
  xml: string,
  page: number,
  counters: { cc: number; bm: number; txbx: number; tc: number },
): { nativeFields: NativeField[]; targets: AnswerTarget[] } {
  const nativeFields: NativeField[] = []
  const targets: AnswerTarget[] = []

  const sdtRe = /<w:sdt>([\s\S]*?)<\/w:sdt>/g
  let m: RegExpExecArray | null
  while ((m = sdtRe.exec(xml)) != null) {
    const inner = m[1]!
    const alias =
      inner.match(/<w:alias[^>]*w:val="([^"]+)"/)?.[1] ??
      inner.match(/<w:tag[^>]*w:val="([^"]+)"/)?.[1] ??
      `sdt-${counters.cc}`
    const id = `cc-${counters.cc}`
    nativeFields.push({ id, name: alias, kind: 'content_control', page })
    targets.push({ id, kind: 'content_control', page, nativeRef: alias, source: 'native' })
    counters.cc += 1
  }

  const bmRe = /<w:bookmarkStart[^>]*w:name="([^"]+)"[^>]*>/g
  let b: RegExpExecArray | null
  while ((b = bmRe.exec(xml)) != null) {
    const name = b[1]!
    if (name.startsWith('_')) continue
    const id = `bm-${counters.bm}`
    nativeFields.push({ id, name, kind: 'bookmark', page })
    targets.push({ id, kind: 'bookmark', page, nativeRef: name, source: 'native' })
    counters.bm += 1
  }

  const txbxRe = /<w:txbxContent>([\s\S]*?)<\/w:txbxContent>/g
  let tx: RegExpExecArray | null
  while ((tx = txbxRe.exec(xml)) != null) {
    const inner = tx[1]!
    const boxText = [...inner.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((x) => decodeXmlEntities(x[1] ?? ''))
      .join('')
      .trim()
    if (boxText.length > 0) {
      counters.txbx += 1
      continue
    }
    const id = `txbx-${counters.txbx}`
    nativeFields.push({ id, name: `Textbox ${counters.txbx + 1}`, kind: 'text_field', page })
    targets.push({ id, kind: 'text_field', page, nativeRef: id, source: 'native' })
    counters.txbx += 1
  }

  const tableTargets = analyzeDocxTableCells(xml, page, counters.tc)
  counters.tc += tableTargets.length
  targets.push(...tableTargets)

  return { nativeFields, targets }
}

/**
 * Erfasst native DOCX-Ziele: Content Controls, Bookmarks, Textfelder,
 * leere Tabellenzellen und VML-Shapes (über alle relevanten XML-Parts).
 */
export function analyzeDocxTargets(source: Buffer): DocxAnalysis {
  const parts = listDocxXmlParts(source)
  if (parts.length === 0) {
    return { nativeFields: [], targets: [], shapes: [], fullText: '' }
  }

  const nativeFields: NativeField[] = []
  const targets: AnswerTarget[] = []
  const textChunks: string[] = []
  const counters = { cc: 0, bm: 0, txbx: 0, tc: 0 }

  for (const part of parts) {
    const xml = readDocxPart(source, part)
    if (!xml) continue
    const page = pageForDocxPart(part)
    const partResult = analyzePartXml(xml, page, counters)
    nativeFields.push(...partResult.nativeFields)
    targets.push(...partResult.targets)
    const texts = [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((x) =>
      decodeXmlEntities(x[1] ?? ''),
    )
    textChunks.push(texts.join(''))
  }

  const shapeTargets = analyzeDocxShapes(source)
  const shapeAnswerTargets = docxShapesToAnswerTargets(shapeTargets)
  const shapes = docxShapesToShapeBlocks(shapeTargets)
  targets.push(...shapeAnswerTargets)

  return {
    nativeFields,
    targets,
    shapes,
    fullText: textChunks.join('\n'),
  }
}
