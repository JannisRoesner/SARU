import { describe, expect, it } from 'vitest'
import {
  concatTransformationMatrix,
  lineTo,
  moveTo,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  StandardFonts,
  stroke,
} from 'pdf-lib'
import {
  clusterPdfAnswerLines,
  detectPdfAnswerLines,
  detectPdfLayoutTargets,
  extractPdfHorizontalStrokes,
} from '../../../server/services/ai/solutions/pdf-answer-lines'
import { buildSolutionPlan } from '../../../server/services/ai/solutions/orchestrator'
import {
  applyFreeTextTaskMeta,
  applyChoiceCellTaskMeta,
  applyTableCellTaskMeta,
} from '../../../server/services/ai/solutions/solvers/free-text-solver'
import { renderPdfSolution } from '../../../server/services/ai/solutions/renderers/pdf-renderer'
import { detectPdfBlankRegions } from '../../../server/services/ai/document-fill'
import { loadPdfjs } from '../../../server/utils/pdfjs'

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

async function rasierenWritingLinesPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595.28, 841.89])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText('Worauf sollten Mädchen und Jungen dabei achten?', {
    x: 30,
    y: 500,
    size: 12,
    font,
  })
  page.drawText(
    'Erkläre kurz, wie Epilieren und Wachsen funktioniert. Erläutere auch die Vor- und Nachteile.',
    { x: 30, y: 260, size: 10, font, maxWidth: 535 },
  )

  for (const y of [470.8611, 448.7534, 426.5993, 404.6695, 382.5617, 360.4077, 337.5461, 315.4382, 293.2842]) {
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(1, 0, 0, 1, 29.8015, y),
      moveTo(0, 0),
      lineTo(534.969, 0),
      stroke(),
      popGraphicsState(),
    )
  }
  for (const y of [191.9809, 170.731, 149.4366, 128.2184, 105.3612]) {
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(1, 0, 0, 1, 29.4183, y),
      moveTo(0, 0),
      lineTo(534.969, 0),
      stroke(),
      popGraphicsState(),
    )
  }

  return Buffer.from(await pdf.save())
}

async function emptyTablePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595.28, 841.89])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText('Fülle die leeren Felder der Tabelle aus.', { x: 50, y: 770, size: 12, font })

  const columns = [
    { x: 50, width: 110, heading: 'Name' },
    { x: 160, width: 140, heading: 'Symptome' },
    { x: 300, width: 140, heading: 'Behandlung' },
    { x: 440, width: 105, heading: 'Schutz' },
  ]
  const yLevels = [700, 675, 600, 525]
  for (const y of yLevels) {
    for (const column of columns) {
      page.drawLine({
        start: { x: column.x, y },
        end: { x: column.x + column.width, y },
        thickness: 0.8,
      })
    }
  }
  for (const column of columns) {
    page.drawText(column.heading, { x: column.x + 5, y: 684, size: 9, font })
  }
  page.drawText('Chlamydien', { x: 55, y: 636, size: 9, font })
  page.drawText('Gonorrhoe', { x: 55, y: 561, size: 9, font })
  return Buffer.from(await pdf.save())
}

async function choiceTablePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595.28, 841.89])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText('Kreuze an, welche Aussagen richtig und welche falsch sind.', {
    x: 50,
    y: 770,
    size: 12,
    font,
  })
  const columns = [
    { x: 50, width: 330, heading: 'Aussagen' },
    { x: 380, width: 80, heading: 'richtig' },
    { x: 460, width: 80, heading: 'falsch' },
  ]
  const yLevels = [700, 675, 630, 585, 540]
  for (const y of yLevels) {
    for (const column of columns) {
      page.drawLine({
        start: { x: column.x, y },
        end: { x: column.x + column.width, y },
        thickness: 0.8,
      })
    }
  }
  for (const column of columns) {
    page.drawText(column.heading, { x: column.x + 5, y: 684, size: 9, font })
  }
  for (const [index, label] of ['Aussage eins', 'Aussage zwei', 'Aussage drei'].entries()) {
    page.drawText(label, { x: 55, y: 645 - index * 45, size: 9, font })
  }
  return Buffer.from(await pdf.save())
}

describe('detectPdfAnswerLines', () => {
  it('erkennt die transformierten breiten Schreiblinien aus AB-Rasieren', async () => {
    const source = await rasierenWritingLinesPdf()
    const detected = await detectPdfAnswerLines(source)
    const extracted = await extractPdfHorizontalStrokes(source)
    const clusters = clusterPdfAnswerLines(extracted.lines, extracted.pageSizes)

    expect(detected.rawLineCount).toBe(14)
    expect(detected.clusterCount).toBe(2)
    expect(detected.targets).toHaveLength(2)
    expect(clusters.map((target) => target.lineCount)).toEqual([9, 5])
  })

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

  it('erkennt leere Tabellenzellen und behandelt ihre Kanten nicht als Antwortlinien', async () => {
    const source = await emptyTablePdf()
    const detected = await detectPdfLayoutTargets(source)

    expect(detected.tableTargets).toHaveLength(6)
    expect(detected.tableTargets.every((target) => target.kind === 'table_cell')).toBe(true)
    expect(detected.lineTargets).toHaveLength(0)

    const plan = buildSolutionPlan({
      documentText:
        'Fülle die leeren Felder der Tabelle aus. Recherchiere mit den Textbausteinen auf der Rückseite.',
      pdfBlanks: [],
      answerTargets: detected.tableTargets,
    })
    const task = plan.tasks.find((item) => item.kind === 'matching_table')
    expect(task?.targets).toHaveLength(6)
    expect(plan.tasks).toHaveLength(1)

    const positioned = applyTableCellTaskMeta(
      {
        summary: 'Tabelle',
        answers: task!.targets.map((target, index) => ({
          id: String(index + 1),
          label: `Lücke ${index + 1}`,
          answer: `Wert ${index + 1}`,
          blankIndex: target.blankIndex,
        })),
        formFields: [],
      },
      plan.tasks,
    )
    expect(positioned.answers.every((answer) => answer.targetId?.startsWith('pdf-table-'))).toBe(
      true,
    )
    expect(positioned.answers.every((answer) => answer.bbox)).toBe(true)
  })

  it('behält normale Schreiblinien im kombinierten Layout-Detektor bei', async () => {
    const source = await writingLinesPdf()
    const detected = await detectPdfLayoutTargets(source)
    expect(detected.tableTargets).toHaveLength(0)
    expect(detected.lineTargets).toHaveLength(2)
  })

  it('markiert bei richtig/falsch genau eine Auswahlzelle pro Aussage', async () => {
    const source = await choiceTablePdf()
    const detected = await detectPdfLayoutTargets(source)
    expect(detected.tableTargets).toHaveLength(6)
    expect(detected.tableTargets.every((target) => target.kind === 'choice_cell')).toBe(true)

    const plan = buildSolutionPlan({
      documentText: 'Kreuze an, welche Aussagen richtig und welche falsch sind.',
      pdfBlanks: [],
      answerTargets: detected.tableTargets,
    })
    const task = plan.tasks.find((item) => item.targets.some((target) => target.kind === 'choice_cell'))
    expect(task?.targets).toHaveLength(6)

    const positioned = applyChoiceCellTaskMeta(
      {
        summary: 'Auswahl',
        answers: [
          { id: '1', label: 'Aussage 1', answer: 'richtig', blankIndex: 0 },
          { id: '2', label: 'Aussage 2', answer: 'falsch', blankIndex: 1 },
          { id: '3', label: 'Aussage 3', answer: 'richtig', blankIndex: 2 },
        ],
        formFields: [],
      },
      plan.tasks,
    )
    expect(positioned.answers.map((answer) => answer.targetId)).toEqual([
      detected.tableTargets[0]!.id,
      detected.tableTargets[3]!.id,
      detected.tableTargets[4]!.id,
    ])

    const rendered = await renderPdfSolution(source, positioned, {
      title: 'Musterlösung',
      sourceFileName: 'AB-Auswahl.pdf',
      tasks: plan.tasks,
    })
    const pdfjs = await loadPdfjs()
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(rendered.buffer), verbosity: 0 })
    try {
      const page = await (await loadingTask.promise).getPage(1)
      const content = await page.getTextContent()
      const marks = content.items.filter(
        (item: { str?: string }) => item.str === 'X',
      )
      expect(marks).toHaveLength(3)
    } finally {
      await loadingTask.destroy()
    }
  })

  it('modelliert AB-Rasieren als zwei offene Overlay-Tasks', async () => {
    const source = await rasierenWritingLinesPdf()
    const detected = await detectPdfAnswerLines(source)
    const plan = buildSolutionPlan({
      documentText:
        'Worauf sollten Mädchen und Jungen dabei achten? Erkläre kurz, wie Epilieren und Wachsen funktioniert. Erläutere auch die Vor- und Nachteile.',
      pdfBlanks: [],
      shapes: detected.shapes,
      answerTargets: detected.targets,
    })

    expect(plan.tasks).toHaveLength(2)
    expect(plan.tasks.every((task) => task.kind === 'free_text_inplace')).toBe(true)
    expect(plan.tasks.every((task) => task.renderMode === 'overlay')).toBe(true)
    expect(plan.tasks.every((task) => task.targets.length === 1)).toBe(true)
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

  it('hält langen Lösungstext innerhalb des Rasieren-Linienblocks', async () => {
    const source = await rasierenWritingLinesPdf()
    const detected = await detectPdfAnswerLines(source)
    const plan = buildSolutionPlan({
      documentText:
        'Worauf sollten Mädchen und Jungen dabei achten? Erkläre kurz, wie Epilieren und Wachsen funktioniert. Erläutere auch die Vor- und Nachteile.',
      pdfBlanks: [],
      shapes: detected.shapes,
      answerTargets: detected.targets,
    })
    const solution = applyFreeTextTaskMeta(
      {
        summary: 'Rasieren',
        answers: [
          { id: '1', label: 'Aufgabe 1', answer: 'FITCHECK1 Hygiene beachten.' },
          {
            id: '2',
            label: 'Aufgabe 2',
            answer: Array.from({ length: 300 }, () => 'FITCHECK2').join(' '),
          },
        ],
        formFields: [],
      },
      plan.tasks,
    )
    const rendered = await renderPdfSolution(source, solution, {
      title: 'Musterlösung',
      sourceFileName: 'AB-Rasieren.pdf',
      tasks: plan.tasks,
    })

    expect(rendered.strategy).toBe('pdf_overlay')
    const pdfjs = await loadPdfjs()
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(rendered.buffer),
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
    })
    try {
      const page = await (await loadingTask.promise).getPage(1)
      const content = await page.getTextContent()
      const fittedItems = content.items.filter(
        (item: { str?: string }) => item.str?.includes('FITCHECK2'),
      ) as Array<{ str: string; transform: number[] }>
      const target = detected.targets[1]!.bbox!
      const top = 841.89 * (1 - target.y)
      const bottom = top - 841.89 * target.h

      expect(fittedItems.length).toBeGreaterThan(0)
      expect(Math.max(...fittedItems.map((item) => item.transform[5]!))).toBeLessThan(top)
      expect(Math.min(...fittedItems.map((item) => item.transform[5]!))).toBeGreaterThanOrEqual(
        bottom,
      )
      expect(fittedItems.at(-1)!.str.endsWith('...')).toBe(true)
    } finally {
      await loadingTask.destroy()
    }
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
