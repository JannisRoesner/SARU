import { describe, expect, it } from 'vitest'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import {
  clusterPdfAnswerLines,
  detectPdfAnswerLines,
  extractPdfHorizontalStrokes,
} from '../../../server/services/ai/solutions/pdf-answer-lines'
import { buildSolutionPlan } from '../../../server/services/ai/solutions/orchestrator'
import { applyFreeTextTaskMeta } from '../../../server/services/ai/solutions/solvers/free-text-solver'
import { renderPdfSolution } from '../../../server/services/ai/solutions/renderers/pdf-renderer'
import { detectPdfBlankRegions } from '../../../server/services/ai/document-fill'

async function writingLinesPdf(opts?: {
  withUnderscoreCloze?: boolean
}): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595.28, 841.89])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText('Erklärt in Stichpunkten, wie ein Orgasmus abläuft.', {
    x: 50,
    y: 780,
    size: 12,
    font,
  })

  // Zwei Schreibblöcke à 3 Linien (wie Orgasmus-AB)
  const blocks = [
    { x: 220, y: 700 },
    { x: 220, y: 600 },
  ]
  for (const block of blocks) {
    for (let i = 0; i < 3; i++) {
      page.drawLine({
        start: { x: block.x, y: block.y - i * 16 },
        end: { x: block.x + 280, y: block.y - i * 16 },
        thickness: 0.8,
        color: rgb(0.12, 0.35, 0.75),
      })
    }
  }

  // Volle Seitenbreite unten – Dekoration, soll ignoriert werden
  page.drawLine({
    start: { x: 40, y: 36 },
    end: { x: 555, y: 36 },
    thickness: 1,
    color: rgb(0.6, 0.6, 0.6),
  })

  if (opts?.withUnderscoreCloze) {
    page.drawText('Die _____________ ist ein Prozess.', {
      x: 50,
      y: 500,
      size: 12,
      font,
    })
  }

  return Buffer.from(await pdf.save())
}

describe('detectPdfAnswerLines', () => {
  it('erkennt und clustert Schreiblinien ohne Cloze zu erzeugen', async () => {
    const source = await writingLinesPdf()
    const blanks = await detectPdfBlankRegions(source)
    expect(blanks.filter((b) => b.kind === 'underscore')).toHaveLength(0)

    const detected = await detectPdfAnswerLines(source)
    expect(detected.rawLineCount).toBeGreaterThanOrEqual(6)
    expect(detected.clusterCount).toBe(2)
    expect(detected.targets).toHaveLength(2)
    expect(detected.targets.every((t) => t.kind === 'answer_line')).toBe(true)
    expect(detected.targets[0]!.bbox).toBeTruthy()
  })

  it('ignoriert sehr kurze und volle Seitenlinien', async () => {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([595, 842])
    page.drawLine({
      start: { x: 100, y: 400 },
      end: { x: 120, y: 400 },
      thickness: 1,
    })
    page.drawLine({
      start: { x: 20, y: 300 },
      end: { x: 575, y: 300 },
      thickness: 1,
    })
    const buf = Buffer.from(await pdf.save())
    const { lines } = await extractPdfHorizontalStrokes(buf)
    expect(lines).toHaveLength(0)
  })

  it('plant free_text_inplace Overlay statt pdf_separate/offen', async () => {
    const source = await writingLinesPdf()
    const detected = await detectPdfAnswerLines(source)
    const plan = buildSolutionPlan({
      documentText:
        'Erklärt in Stichpunkten, wie ein Orgasmus bei Mädchen und Jungen abläuft.',
      pdfBlanks: [],
      shapes: detected.shapes,
      answerTargets: detected.targets,
    })

    expect(plan.fillMode).toBe('lueckentext')
    expect(plan.tasks.some((t) => t.kind === 'free_text_inplace')).toBe(true)
    expect(plan.tasks.some((t) => t.kind === 'free_text_separate')).toBe(false)
    expect(plan.tasks.find((t) => t.kind === 'free_text_inplace')!.renderMode).toBe(
      'overlay',
    )
  })

  it('lässt Underscore-Cloze priorisieren und überspringt Linien-Detection in der Pipeline-Logik', async () => {
    const source = await writingLinesPdf({ withUnderscoreCloze: true })
    const blanks = await detectPdfBlankRegions(source)
    expect(blanks.some((b) => b.kind === 'underscore')).toBe(true)

    // Wie in solutions.ts: bei vorhandenen Blanks keine Answer-Lines einspeisen.
    const plan = buildSolutionPlan({
      documentText: 'Die _____________ ist ein Prozess. Erklärt den Vorgang.',
      pdfBlanks: blanks,
      shapes: [],
      answerTargets: [],
    })
    expect(plan.tasks.some((t) => t.kind === 'cloze')).toBe(true)
    expect(
      plan.tasks.some((t) => t.targets.some((x) => x.kind === 'answer_line')),
    ).toBe(false)
  })

  it('weist Freitext-Antworten Linien-bboxes zu und rendert Overlay', async () => {
    const source = await writingLinesPdf()
    const detected = await detectPdfAnswerLines(source)
    const plan = buildSolutionPlan({
      documentText: 'Erklärt in Stichpunkten den Prozess.',
      pdfBlanks: [],
      shapes: detected.shapes,
      answerTargets: detected.targets,
    })

    const withMeta = applyFreeTextTaskMeta(
      {
        summary: 'Orgasmus',
        answers: [
          {
            id: '1',
            label: 'Mädchen 1',
            answer: '- Erregung beginnt.',
            blankIndex: null,
          },
          {
            id: '2',
            label: 'Mädchen 2',
            answer: '- Steigerung der Erregung.',
            blankIndex: null,
          },
        ],
        formFields: [],
      },
      plan.tasks,
    )
    expect(withMeta.answers[0]!.bbox).toBeTruthy()
    expect(withMeta.answers[0]!.fieldType).toBe('freitext')
    expect(withMeta.answers[1]!.bbox).toBeTruthy()

    const rendered = await renderPdfSolution(source, withMeta, {
      title: 'Musterlösung',
      sourceFileName: 'AB-Orgasmus.pdf',
      tasks: plan.tasks,
    })
    expect(rendered.strategy).toBe('pdf_overlay')
  })
})

describe('clusterPdfAnswerLines', () => {
  it('fasst drei nahe Linien zu einem Block', () => {
    const pageSizes = [{ width: 595, height: 842 }]
    const clusters = clusterPdfAnswerLines(
      [
        { pageIndex: 0, x: 220, y: 700, width: 280, height: 1 },
        { pageIndex: 0, x: 220, y: 684, width: 280, height: 1 },
        { pageIndex: 0, x: 220, y: 668, width: 280, height: 1 },
        { pageIndex: 0, x: 220, y: 500, width: 280, height: 1 },
      ],
      pageSizes,
    )
    expect(clusters).toHaveLength(2)
    expect(clusters[0]!.lineCount).toBe(3)
    expect(clusters[1]!.lineCount).toBe(1)
  })
})
