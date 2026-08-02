import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  assessPdfLayoutPlan,
  buildPdfLayoutVisionPrompt,
  parsePdfLayoutVisionResponse,
} from '../../../server/services/ai/solutions/repair/pdf-layout-vision'
import type { AnswerTarget, TaskBlock } from '../../../server/services/ai/solutions/types'
import { applyFreeTextTaskMeta } from '../../../server/services/ai/solutions/solvers/free-text-solver'
import { renderPdfSolution } from '../../../server/services/ai/solutions/renderers/pdf-renderer'

function task(overrides: Partial<TaskBlock> = {}): TaskBlock {
  return {
    id: 'p1-t1',
    page: 1,
    bbox: { x: 0.05, y: 0.3, w: 0.9, h: 0.2 },
    instruction: 'Worauf sollten Mädchen und Jungen achten?',
    kind: 'free_text_separate',
    confidence: 0.88,
    evidence: ['open-ended operator'],
    targets: [],
    renderMode: 'appendix',
    renderConfidence: 'high',
    ...overrides,
  }
}

describe('assessPdfLayoutPlan', () => {
  const rasierenText =
    'Worauf sollten Mädchen und Jungen dabei achten? Erkläre kurz, wie Epilieren und Wachsen funktioniert. Erläutere auch die Vor- und Nachteile.'

  it('fordert Vision bei offenen Aufgaben ohne Antwortziele an', () => {
    const assessment = assessPdfLayoutPlan({
      documentText: rasierenText,
      tasks: [task(), task({ id: 'p1-t2', instruction: 'Erkläre Epilieren.' })],
    })

    expect(assessment.shouldCheck).toBe(true)
    expect(assessment.openTaskCount).toBe(2)
    expect(assessment.answerTargetCount).toBe(0)
    expect(assessment.reasons).toContain(
      'open-response tasks have no in-place answer targets',
    )
  })

  it('prüft auch gescannte PDFs ohne erkannten Text oder Tasks', () => {
    const assessment = assessPdfLayoutPlan({ documentText: '', tasks: [] })

    expect(assessment.shouldCheck).toBe(true)
    expect(assessment.reasons).toContain('PDF solution plan contains no detectable tasks')
  })

  it('akzeptiert einen plausiblen nativen Overlay-Plan ohne Vision-Aufruf', () => {
    const firstTarget: AnswerTarget = {
      id: 'line-1',
      kind: 'answer_line',
      page: 1,
      bbox: { x: 0.05, y: 0.42, w: 0.9, h: 0.23 },
      source: 'native',
    }
    const secondTarget: AnswerTarget = {
      id: 'line-2',
      kind: 'answer_line',
      page: 1,
      bbox: { x: 0.05, y: 0.76, w: 0.9, h: 0.12 },
      source: 'native',
    }
    const assessment = assessPdfLayoutPlan({
      documentText: rasierenText,
      tasks: [
        task({
          kind: 'free_text_inplace',
          renderMode: 'overlay',
          renderConfidence: 'high',
          targets: [firstTarget],
        }),
        task({
          id: 'p1-t2',
          instruction: 'Erkläre Epilieren.',
          kind: 'free_text_inplace',
          renderMode: 'overlay',
          renderConfidence: 'high',
          targets: [secondTarget],
        }),
      ],
    })

    expect(assessment.shouldCheck).toBe(false)
    expect(assessment.inplaceTaskCount).toBe(2)
    expect(assessment.answerTargetCount).toBe(2)
  })

  it('erzwingt die visuelle Prüfung für PDFs auch bei plausibler lokaler Geometrie', () => {
    const assessment = assessPdfLayoutPlan({
      documentText: 'Kreuze an, welche Aussagen richtig und falsch sind.',
      tasks: [
        task({
          kind: 'matching_table',
          renderMode: 'overlay',
          confidence: 0.95,
          targets: [
            {
              id: 'choice-1',
              kind: 'choice_cell',
              page: 1,
              bbox: { x: 0.7, y: 0.4, w: 0.03, h: 0.03 },
              choiceValue: 'richtig',
              source: 'native',
            },
          ],
        }),
      ],
      requireVision: true,
    })

    expect(assessment.shouldCheck).toBe(true)
    expect(assessment.reasons).toContain('PDF layout requires mandatory visual verification')
  })
})

describe('parsePdfLayoutVisionResponse', () => {
  it('erzeugt zwei Overlay-Tasks und bevorzugt überlappende native Geometrie', () => {
    const native: AnswerTarget = {
      id: 'native-line-1',
      kind: 'answer_line',
      page: 1,
      bbox: { x: 0.05, y: 0.42, w: 0.9, h: 0.23 },
      source: 'native',
    }
    const parsed = parsePdfLayoutVisionResponse(
      JSON.stringify({
        verdict: 'repair',
        tasks: [
          {
            instruction: 'Worauf sollten Mädchen und Jungen achten?',
            kind: 'open_response',
            page: 1,
            confidence: 0.96,
            answerRegions: [
              {
                kind: 'line_block',
                bbox: { x: 0.052, y: 0.421, w: 0.895, h: 0.228 },
              },
            ],
          },
          {
            instruction: 'Erkläre Epilieren und Wachsen.',
            kind: 'open_response',
            page: 1,
            confidence: 0.93,
            answerRegions: [
              {
                kind: 'line_block',
                bbox: { x: 0.05, y: 0.76, w: 0.9, h: 0.12 },
              },
            ],
          },
        ],
      }),
      [native],
    )

    expect(parsed?.tasks).toHaveLength(2)
    expect(parsed?.tasks.every((entry) => entry.kind === 'free_text_inplace')).toBe(
      true,
    )
    expect(parsed?.tasks.every((entry) => entry.renderMode === 'overlay')).toBe(true)
    expect(parsed?.tasks[0]!.targets[0]).toMatchObject({
      id: 'native-line-1',
      source: 'native',
    })
    expect(parsed?.tasks[1]!.targets[0]).toMatchObject({ source: 'vision' })
  })

  it('verwirft unsichere Tasks und ungültige Bounding-Boxes', () => {
    const parsed = parsePdfLayoutVisionResponse(
      JSON.stringify({
        verdict: 'repair',
        tasks: [
          {
            instruction: 'Unsicher',
            kind: 'open_response',
            page: 1,
            confidence: 0.3,
            answerRegions: [
              { kind: 'line_block', bbox: { x: 0.1, y: 0.2, w: 0.8, h: 0.2 } },
            ],
          },
          {
            instruction: 'Keine gültige Box',
            kind: 'open_response',
            page: 1,
            confidence: 0.9,
            answerRegions: [
              { kind: 'line_block', bbox: { x: 0.1, y: 0.2, w: 0, h: 0 } },
            ],
          },
        ],
      }),
    )

    expect(parsed?.tasks).toHaveLength(1)
    expect(parsed?.tasks[0]).toMatchObject({
      kind: 'free_text_separate',
      renderMode: 'appendix',
      targets: [],
    })
  })

  it('führt reparierte Vision-Tasks bis zur PDF-Overlay-Strategie', async () => {
    const parsed = parsePdfLayoutVisionResponse(
      JSON.stringify({
        verdict: 'repair',
        tasks: [
          {
            instruction: 'Beantworte die Frage.',
            kind: 'open_response',
            page: 1,
            confidence: 0.95,
            answerRegions: [
              { kind: 'line_block', bbox: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 } },
            ],
          },
        ],
      }),
    )
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([595, 842])
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    page.drawText('Beantworte die Frage.', { x: 60, y: 700, size: 12, font })
    const source = Buffer.from(await pdf.save())
    const solution = applyFreeTextTaskMeta(
      {
        summary: 'Antwort',
        answers: [
          { id: '1', label: 'Aufgabe 1', answer: 'Eine kurze Musterantwort.' },
        ],
        formFields: [],
      },
      parsed!.tasks,
    )

    const rendered = await renderPdfSolution(source, solution, {
      title: 'Musterlösung',
      sourceFileName: 'Arbeitsblatt.pdf',
      tasks: parsed!.tasks,
    })

    expect(rendered.strategy).toBe('pdf_overlay')
    expect(rendered.buffer.length).toBeGreaterThan(source.length)
  })
})

describe('buildPdfLayoutVisionPrompt', () => {
  it('begrenzt Vision auf Layoutprüfung und Linienblöcke', () => {
    const assessment = assessPdfLayoutPlan({
      documentText: 'Worauf sollte man achten?',
      tasks: [],
    })
    const prompt = buildPdfLayoutVisionPrompt({
      documentText: 'Worauf sollte man achten?',
      tasks: [],
      assessment,
    })

    expect(prompt).toContain('nicht seine Lösungen')
    expect(prompt).toContain('als EINEN line_block zusammenfassen')
    expect(prompt).toContain('Keine Antworttexte erzeugen')
  })
})
