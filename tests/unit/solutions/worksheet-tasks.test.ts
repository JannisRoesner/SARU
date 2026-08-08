import { describe, expect, it } from 'vitest'
import {
  detectGlossaryTask,
  detectImageLabelingTask,
  detectWorksheetTasks,
  extractGlossaryTerms,
} from '../../../server/services/ai/solutions/worksheet-tasks'
import { buildSolutionPlan } from '../../../server/services/ai/solutions/orchestrator'
import { isLikelyLayoutGap } from '../../../server/services/ai/document-fill'
import type { PdfBlankRegion } from '../../../server/services/ai/document-fill'

const HODEN_TEXT = `
Du bist kein Werwolf – Sexualerziehung © WDR 2020
02_Arbeitsblatt: Die Hoden
Was passiert eigentlich genau in den Hoden? Schaue dir dazu aus der Sendereihe „Du bist kein Werwolf“ den passenden Filmclip „Die Hoden“ an (Clip 02). Bearbeite anschließend die Aufgaben.
Ordne die fünf Begriffe dem Bild zu: Harnröhre, Hoden, Nebenhoden, Samenstrang, Hodensack
Die Hoden sind sehr schmerzempfindlich. Jeder Junge passt deshalb besonders gut auf, dass er an dieser Stelle keinen Schlag oder Stoß abbekommt. Stelle dir vor, bei einem Jungen würde ein Tritt in die Hoden weniger weh tun – nur etwa so viel, wie ein Tritt in den Po. Warum wäre das schlecht für seine Familienplanung? Und wenn das bei allen Jungs so wäre – was könnte das für den Fortbestand der Menschheit bedeuten?
Welche umgangssprachlichen Begriffe für „Hoden“ kennst du? Nenne mindestens drei.
Wenn die Hoden doch so empfindlich sind – warum hängen sie dann überhaupt außen und liegen nicht beispielsweise gut geschützt im Bauch? Recherchiere dazu im Internet auf der Seite www.dubistkeinwerwolf.de in der Rubrik „Mein Körper“ und beantworte dann die Frage. Erkläre auch, wie die Hoden bei Kälte geschützt werden. Schreibe mindestens drei Sätze.
02_Arbeitsblatt: Glossar „Die Hoden“
Vervollständige das Glossar mit wichtigen Begriffen aus dem Bereich Sexualaufklärung.
Begriff Bedeutung Ejakulation Hoden Hodenkanälchen Hodenläppchen Hodensack Leydig-Zwischenzellen Nebenhoden Samenstrang
`

describe('worksheet-tasks (AB Hoden)', () => {
  it('erkennt Bildbeschriftung mit Wortliste', () => {
    const task = detectImageLabelingTask(HODEN_TEXT)
    expect(task).not.toBeNull()
    expect(task!.terms).toEqual([
      'Harnröhre',
      'Hoden',
      'Nebenhoden',
      'Samenstrang',
      'Hodensack',
    ])
  })

  it('erkennt Glossarbegriffe', () => {
    const terms = extractGlossaryTerms(HODEN_TEXT)
    expect(terms).toContain('Ejakulation')
    expect(terms).toContain('Nebenhoden')
    expect(terms.length).toBeGreaterThanOrEqual(6)
    expect(detectGlossaryTask(HODEN_TEXT)?.kind).toBe('glossary')
  })

  it('segmentiert mehrere Teilaufgaben', () => {
    const tasks = detectWorksheetTasks(HODEN_TEXT)
    expect(tasks.some((t) => t.kind === 'image_labeling')).toBe(true)
    expect(tasks.some((t) => t.kind === 'glossary')).toBe(true)
    const open = tasks.filter((t) => t.kind === 'open_ended')
    expect(open).toHaveLength(3)
    expect(open.some((t) =>
      /warum hängen sie/i.test(t.instruction) && /bei Kälte geschützt/i.test(t.instruction),
    )).toBe(true)
  })

  it('filtert Glossar-Header-Gap Begriff|Bedeutung', () => {
    expect(
      isLikelyLayoutGap(
        {
          kind: 'gap',
          x: 77,
          width: 73,
          leftText: 'Begriff',
          rightText: 'Bedeutung',
        },
        595,
      ),
    ).toBe(true)
  })

  it('buildSolutionPlan: offen mit mehreren Tasks, kein Fake-Cloze', () => {
    const fakeGap: PdfBlankRegion = {
      pageIndex: 1,
      blankIndex: 0,
      x: 77,
      y: 679,
      width: 73,
      height: 12,
      kind: 'gap',
      leftText: 'Begriff',
      rightText: 'Bedeutung',
    }
    // Gap sollte bereits vor Plan gefiltert sein – zusätzlich Suppression im Segmenter.
    const plan = buildSolutionPlan({
      documentText: HODEN_TEXT,
      pdfBlanks: [fakeGap],
    })
    expect(plan.fillMode).toBe('offen')
    expect(plan.tasks.some((t) => t.kind === 'cloze')).toBe(false)
    expect(plan.tasks.some((t) => t.kind === 'matching_inline')).toBe(true)
    expect(plan.tasks.some((t) => t.kind === 'free_text_separate')).toBe(true)
    expect(plan.candidateBank?.candidates.map((c) => c.value)).toEqual([
      'Harnröhre',
      'Hoden',
      'Nebenhoden',
      'Samenstrang',
      'Hodensack',
    ])
  })
})
