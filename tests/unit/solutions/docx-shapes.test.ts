import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import {
  analyzeDocxShapes,
  docxShapesToAnswerTargets,
  docxShapesToShapeBlocks,
} from '../../../server/services/ai/solutions/docx-shapes'
import { analyzeDocxTargets } from '../../../server/services/ai/solutions/docx-analyzer'
import { mergeNativeAndVisualTargets } from '../../../server/services/ai/solutions/docx-target-merger'
import { buildDocxRenderPlan } from '../../../server/services/ai/solutions/docx-render-plan'
import type { TaskBlock } from '../../../server/services/ai/solutions/types'

function docxWith(bodyInner: string): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:v="urn:schemas-microsoft-com:vml"
  xmlns:o="urn:schemas-microsoft-com:office:office">
  <w:body>${bodyInner}<w:sectPr/></w:body>
</w:document>`
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rels),
      'word/document.xml': strToU8(documentXml),
    }),
  )
}

describe('analyzeDocxShapes', () => {
  it('erkennt v:line und v:oval als Antwortziele', () => {
    const source = docxWith(`
      <w:p><w:r><w:t>Zeichne die Chromosomen ein.</w:t></w:r></w:p>
      <w:p><w:r><w:pict>
        <v:line style="width:120pt;height:2pt;left:40pt;top:200pt" id="line1"/>
      </w:pict></w:r></w:p>
      <w:p><w:r><w:pict>
        <v:oval style="width:60pt;height:60pt;left:80pt;top:300pt" id="oval1"/>
      </w:pict></w:r></w:p>
      <w:p><w:r><w:pict>
        <v:oval style="width:60pt;height:60pt;left:160pt;top:300pt" id="oval2"/>
      </w:pict></w:r></w:p>
      <w:p><w:r><w:pict>
        <v:oval style="width:60pt;height:60pt;left:240pt;top:300pt" id="oval3"/>
      </w:pict></w:r></w:p>
      <w:p><w:r><w:pict>
        <v:rect style="width:80pt;height:40pt;left:40pt;top:400pt" id="box1"/>
      </w:pict></w:r></w:p>
    `)

    const shapes = analyzeDocxShapes(source)
    expect(shapes.some((s) => s.kind === 'line')).toBe(true)
    expect(shapes.filter((s) => s.kind === 'oval').length).toBeGreaterThanOrEqual(3)
    expect(shapes.some((s) => s.kind === 'box')).toBe(true)

    const blocks = docxShapesToShapeBlocks(shapes)
    expect(blocks.length).toBe(shapes.length)

    const targets = docxShapesToAnswerTargets(shapes)
    expect(targets.every((t) => t.source === 'native')).toBe(true)
    expect(targets.some((t) => t.kind === 'answer_line')).toBe(true)
    expect(targets.some((t) => t.kind === 'shape_oval')).toBe(true)
  })

  it('ignoriert zu kleine Dekorations-Shapes und befüllte Ovale', () => {
    const source = docxWith(`
      <w:p><w:r><w:pict>
        <v:oval style="width:5pt;height:5pt" id="tiny"/>
      </w:pict></w:r></w:p>
      <w:p><w:r><w:pict>
        <v:oval style="width:50pt;height:50pt" id="labeled">
          <v:textbox><w:txbxContent><w:p><w:r><w:t>bereits Text</w:t></w:r></w:p></w:txbxContent></v:textbox>
        </v:oval>
      </w:pict></w:r></w:p>
    `)
    const shapes = analyzeDocxShapes(source)
    expect(shapes).toHaveLength(0)
  })
})

describe('analyzeDocxTargets + shapes', () => {
  it('liefert shapes und table_cell Targets', () => {
    const source = docxWith(`
      <w:tbl>
        <w:tr>
          <w:tc><w:p><w:r/></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>gefüllt</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t xml:space="preserve">   </w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
      <w:p><w:r><w:pict>
        <v:oval style="width:40pt;height:40pt" id="o1"/>
      </w:pict></w:r></w:p>
    `)
    const analysis = analyzeDocxTargets(source)
    expect(analysis.shapes.length).toBeGreaterThanOrEqual(1)
    expect(analysis.targets.filter((t) => t.kind === 'table_cell').length).toBeGreaterThanOrEqual(1)
    expect(analysis.targets.some((t) => t.kind === 'shape_oval')).toBe(true)
  })
})

describe('mergeNativeAndVisualTargets', () => {
  it('merged überlappende BBoxes und behält unmatched Vision-Targets', () => {
    const native = [
      {
        id: 'shape-0',
        kind: 'shape_oval' as const,
        page: 1,
        bbox: { x: 0.1, y: 0.2, w: 0.1, h: 0.1 },
        source: 'native' as const,
      },
    ]
    const visual = [
      {
        id: 'vision-0',
        kind: 'shape_oval' as const,
        page: 1,
        bbox: { x: 0.12, y: 0.22, w: 0.1, h: 0.1 },
        source: 'vision' as const,
      },
      {
        id: 'vision-1',
        kind: 'shape_box' as const,
        page: 1,
        bbox: { x: 0.7, y: 0.7, w: 0.1, h: 0.1 },
        source: 'vision' as const,
      },
    ]
    const result = mergeNativeAndVisualTargets(native, visual)
    expect(result.matchedPairs).toBe(1)
    expect(result.unmatchedVisual).toBe(1)
    expect(result.merged).toHaveLength(2)
    expect(result.merged.some((t) => t.source === 'vision')).toBe(true)
  })
})

describe('buildDocxRenderPlan', () => {
  it('plant blanks + appendix als docx_mixed', () => {
    const tasks: TaskBlock[] = [
      {
        id: 'p1-t1',
        page: 1,
        bbox: { x: 0, y: 0, w: 1, h: 0.5 },
        instruction: 'Lückentext',
        kind: 'cloze',
        confidence: 0.9,
        evidence: [],
        targets: [{ id: 'blank-0', kind: 'blank', page: 1, blankIndex: 0 }],
        renderMode: 'overlay',
        renderConfidence: 'high',
      },
      {
        id: 'p1-open-1',
        page: 1,
        bbox: { x: 0, y: 0.8, w: 1, h: 0.1 },
        instruction: 'Beschreiben Sie …',
        kind: 'free_text_separate',
        confidence: 0.85,
        evidence: [],
        targets: [],
        renderMode: 'appendix',
        renderConfidence: 'high',
      },
    ]
    const plan = buildDocxRenderPlan(tasks, {
      summary: 'Test',
      answers: [
        { id: '1', label: 'Lücke 1', answer: 'Hoden', blankIndex: 0 },
        {
          id: '2',
          label: 'Aufgabe 1',
          answer: 'Lange Erklärung '.repeat(5),
          fieldType: 'freitext',
        },
      ],
      formFields: [],
    })
    expect(plan.routes.some((r) => r.mode === 'blanks')).toBe(true)
    expect(plan.routes.some((r) => r.mode === 'appendix')).toBe(true)
    expect(plan.strategy).toBe('docx_mixed')
    expect(plan.appendOpenAnswers).toBe(true)
  })
})
