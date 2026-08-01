import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import {
  applyDiagramMarksToDocx,
  fillVmlShapesWithLabels,
} from '../../../server/services/ai/solutions/renderers/docx-diagram-renderer'
import { parseDocxTargetsVisionResponse } from '../../../server/services/ai/solutions/repair/docx-targets-vision'
import {
  highlightDocxPrefilledClozeAnswers,
  parseStructuredSolution,
} from '../../../server/services/ai/document-fill'
import { segmentTasks } from '../../../server/services/ai/solutions/task-segmenter'
import { analyzeDocument } from '../../../server/services/ai/solutions/document-analyzer'
import { classifyTasks } from '../../../server/services/ai/solutions/task-classifier'
import { renderDocxSolution } from '../../../server/services/ai/solutions/renderers/docx-renderer'

function docxWith(bodyInner: string): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyInner}<w:sectPr/></w:body>
</w:document>`
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),
      '_rels/.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
      'word/document.xml': strToU8(documentXml),
    }),
  )
}

describe('diagram_completion', () => {
  it('segmentiert Oval-Cluster als diagram_completion', () => {
    const text = 'Zeichne die Chromosomen in die Kreise ein.\nMeiose-Diagramm.'
    const doc = analyzeDocument({
      fullText: text,
      shapes: [
        { id: 'shape-0', page: 1, kind: 'oval', bbox: { x: 0.1, y: 0.3, w: 0.1, h: 0.1 } },
        { id: 'shape-1', page: 1, kind: 'oval', bbox: { x: 0.3, y: 0.3, w: 0.1, h: 0.1 } },
        { id: 'shape-2', page: 1, kind: 'oval', bbox: { x: 0.5, y: 0.3, w: 0.1, h: 0.1 } },
      ],
    })
    const tasks = classifyTasks(segmentTasks({ document: doc }))
    expect(tasks.some((t) => t.kind === 'diagram_completion')).toBe(true)
    const diagram = tasks.find((t) => t.kind === 'diagram_completion')!
    expect(diagram.targets).toHaveLength(3)
    expect(diagram.renderMode).toBe('native')
  })

  it('schreibt diagramMarks in Textboxen', () => {
    const source = docxWith(`
      <w:drawing><w:txbxContent><w:p><w:r><w:t></w:t></w:r></w:p></w:txbxContent></w:drawing>
      <w:drawing><w:txbxContent><w:p><w:r><w:t></w:t></w:r></w:p></w:txbxContent></w:drawing>
    `)
    const result = applyDiagramMarksToDocx(
      source,
      {
        summary: 'Meiose',
        answers: [],
        formFields: [],
        diagramMarks: [
          { kind: 'label', text: 'diploid', targetId: 'txbx-0' },
          { kind: 'chromosome', form: 'two_chromatid', count: 2, targetId: 'txbx-1' },
        ],
      },
      [
        { id: 'txbx-0', kind: 'text_field', page: 1, nativeRef: 'txbx-0' },
        { id: 'txbx-1', kind: 'text_field', page: 1, nativeRef: 'txbx-1' },
      ],
    )
    expect(result.filled).toBeGreaterThanOrEqual(1)
    const xml = strFromU8(unzipSync(new Uint8Array(result.buffer))['word/document.xml']!)
    expect(xml).toContain('diploid')
  })

  it('parst diagramMarks aus Modell-JSON', () => {
    const parsed = parseStructuredSolution(
      JSON.stringify({
        summary: 'Diagramm',
        answers: [],
        formFields: [],
        diagramMarks: [
          { kind: 'label', text: 'Zweichromatid', targetId: 'shape-0' },
          { kind: 'chromosome', form: 'one_chromatid', count: 4, targetId: 'shape-1' },
        ],
      }),
    )
    expect(parsed.diagramMarks).toHaveLength(2)
    expect(parsed.diagramMarks![0]).toMatchObject({ kind: 'label', targetId: 'shape-0' })
  })
})

describe('parseDocxTargetsVisionResponse', () => {
  it('liest Vision-JSON in AnswerTargets', () => {
    const targets = parseDocxTargetsVisionResponse(
      JSON.stringify({
        targets: [
          { kind: 'oval', bbox: { x: 0.2, y: 0.3, w: 0.1, h: 0.1 }, nearbyText: 'Kreis' },
          { kind: 'line', bbox: { x: 0.1, y: 0.5, w: 0.4, h: 0.02 } },
        ],
      }),
    )
    expect(targets).toHaveLength(2)
    expect(targets[0]!.kind).toBe('shape_oval')
    expect(targets[0]!.source).toBe('vision')
    expect(targets[1]!.kind).toBe('answer_line')
  })
})

describe('fillVmlShapesWithLabels', () => {
  it('schreibt Labels in self-closing VML-Ovale', () => {
    const xml = `<w:body><w:p><w:r><w:pict><v:oval id="_x0000_s2120" style="width:62pt;height:62pt"/></w:pict></w:r></w:p></w:body>`
    const result = fillVmlShapesWithLabels(xml, [
      { shapeId: '_x0000_s2120', text: '||' },
    ])
    expect(result.filled).toBe(1)
    expect(result.xml).toContain('||')
    expect(result.xml).toContain('<v:textbox')
    expect(result.xml).toContain('</v:oval>')
  })
})

describe('highlightDocxPrefilledClozeAnswers', () => {
  it('färbt Antwortwörter zwischen Space-Polstern blau', () => {
    const source = docxWith(`
      <w:p>
        <w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>Im</w:t></w:r>
        <w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">    </w:t></w:r>
        <w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>Hoden</w:t></w:r>
        <w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">       </w:t></w:r>
        <w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>des Mannes</w:t></w:r>
      </w:p>
    `)
    const result = highlightDocxPrefilledClozeAnswers(source)
    expect(result.highlighted).toBe(1)
    const xml = strFromU8(unzipSync(new Uint8Array(result.buffer))['word/document.xml']!)
    expect(xml).toContain('Hoden')
    expect(xml).toContain('w:val="1F4E9B"')
  })
})

describe('renderDocxSolution teacher worksheet', () => {
  it('markiert vorbefüllte Lücken und hängt keinen JSON-/Shape-Anhang an', () => {
    const source = docxWith(`
      <w:p>
        <w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>Im</w:t></w:r>
        <w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">    </w:t></w:r>
        <w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>Hoden</w:t></w:r>
        <w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">       </w:t></w:r>
        <w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>des Mannes mit</w:t></w:r>
        <w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">      </w:t></w:r>
        <w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>haploidem</w:t></w:r>
        <w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">    </w:t></w:r>
        <w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>Chromosomensatz.</w:t></w:r>
      </w:p>
      <w:p><w:r><w:pict><v:oval id="_x0000_s2120" style="width:62pt;height:62pt"/></w:pict></w:r></w:p>
    `)

    const result = renderDocxSolution(
      source,
      {
        summary: 'Meiose',
        answers: [
          { id: '1', label: 'Lücke 1', answer: 'Hoden', blankIndex: 0 },
          { id: '2', label: 'shape-2', answer: 'shape-2' },
        ],
        formFields: [],
        diagramMarks: [
          { kind: 'chromosome', form: 'two_chromatid', count: 1, targetId: 'shape-0' },
        ],
      },
      {
        title: 'Musterlösung',
        sourceFileName: 'test.docx',
        tasks: [
          {
            id: 'p1-diagram',
            page: 1,
            kind: 'diagram_completion',
            instruction: 'Zeichne Chromosomen',
            targets: [
              {
                id: 'shape-0',
                kind: 'shape_oval',
                page: 1,
                nativeRef: '_x0000_s2120',
                source: 'native',
              },
            ],
            renderMode: 'native',
            renderConfidence: 'medium',
          },
        ],
      },
    )

    expect(result.strategy).toBe('docx_inplace')
    const xml = strFromU8(unzipSync(new Uint8Array(result.buffer))['word/document.xml']!)
    expect(xml).toContain('w:val="1F4E9B"')
    expect(xml).toContain('||')
    expect(xml).not.toContain('Musterlösung (KI)')
    expect(xml).not.toContain('shape-2')
  })
})
