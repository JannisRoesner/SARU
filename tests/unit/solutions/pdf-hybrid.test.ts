import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { renderPdfSolution } from '../../../server/services/ai/solutions/renderers/pdf-renderer'
import type { TaskBlock } from '../../../server/services/ai/solutions/types'
import type { StructuredSolution } from '../../../server/services/ai/document-fill'

async function sourcePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([595, 842])
  page.drawText('Arbeitsblatt', { x: 50, y: 780, size: 14, font })
  return Buffer.from(await pdf.save())
}

describe('renderPdfSolution hybrid', () => {
  it('erzeugt pdf_hybrid bei Overlay- und Appendix-Tasks', async () => {
    const source = await sourcePdf()
    const tasks: TaskBlock[] = [
      {
        id: 'p1-t1',
        page: 1,
        bbox: { x: 0, y: 0, w: 1, h: 0.5 },
        instruction: 'Lückentext',
        kind: 'cloze',
        confidence: 0.9,
        evidence: ['blanks'],
        targets: [
          {
            id: 'blank-0',
            kind: 'blank',
            page: 1,
            blankIndex: 0,
            leftText: 'Die',
            rightText: 'ist',
            bbox: { x: 0.1, y: 0.2, w: 0.2, h: 0.03 },
          },
        ],
        renderMode: 'overlay',
      },
      {
        id: 'p1-open-1',
        page: 1,
        bbox: { x: 0, y: 0.6, w: 1, h: 0.2 },
        instruction: 'Beschreiben Sie die GUI.',
        kind: 'free_text_separate',
        confidence: 0.8,
        evidence: ['open'],
        targets: [],
        renderMode: 'appendix',
      },
    ]

    const solution: StructuredSolution = {
      summary: 'Hybrid',
      answers: [
        {
          id: '1',
          label: 'Lücke 1',
          answer: 'Wurzel',
          blankIndex: 0,
          page: 1,
          fieldType: 'luecke',
          bbox: { x: 0.1, y: 0.2, w: 0.2, h: 0.03 },
        },
        {
          id: '2',
          label: 'Aufgabe 2',
          answer: 'Die GUI zeigt Komponenten A und B.',
          blankIndex: null,
          page: 1,
          fieldType: 'freitext',
        },
      ],
      formFields: [],
    }

    const filled = await renderPdfSolution(source, solution, {
      title: 'Musterlösung Test',
      sourceFileName: 'ab.pdf',
      tasks,
    })
    expect(filled.strategy).toBe('pdf_hybrid')
    const out = await PDFDocument.load(filled.buffer)
    expect(out.getPageCount()).toBeGreaterThan(1)
  })
})
