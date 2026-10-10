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

const BLATT_TEXT = `
Du bist kein Werwolf – Sexualerziehung © WDR 2020
02_Arbeitsblatt: Das Blatt
Was passiert eigentlich genau im Blatt? Schaue dir dazu den passenden Filmclip „Das Blatt“ an (Clip 02). Bearbeite anschließend die Aufgaben.
Ordne die fünf Begriffe dem Bild zu: Blattstiel, Blattspreite, Blattader, Oberhaut, Spaltöffnung
Das Blatt ist sehr dünn. Jede Pflanze braucht deshalb eine schützende Wachsschicht. Stelle dir vor, ein Blatt hätte keine Wachsschicht und würde bei Sonne sofort austrocknen. Warum wäre das schlecht für die Pflanze? Und wenn das bei allen Bäumen so wäre – was könnte das für das Klima bedeuten?
Welche Pflanzen mit besonders großen Blättern kennst du? Nenne mindestens drei.
Wenn Blätter so dünn sind – warum haben sie dann überhaupt eine große Fläche und keine kleine, kompakte Form? Recherchiere dazu im Internet auf einer Biologieseite und beantworte dann die Frage. Erkläre auch, wie Blätter bei Hitze Wasser sparen. Schreibe mindestens drei Sätze.
02_Arbeitsblatt: Glossar „Das Blatt“
Vervollständige das Glossar mit wichtigen Begriffen aus dem Bereich Pflanzenkunde.
Begriff Bedeutung Transpiration Blattader Blattspreite Blattstiel Chloroplast Oberhaut Spaltöffnung Wachsschicht
`

describe('worksheet-tasks (AB Blatt)', () => {
  it('erkennt Bildbeschriftung mit Wortliste', () => {
    const task = detectImageLabelingTask(BLATT_TEXT)
    expect(task).not.toBeNull()
    expect(task!.terms).toEqual([
      'Blattstiel',
      'Blattspreite',
      'Blattader',
      'Oberhaut',
      'Spaltöffnung',
    ])
  })

  it('erkennt Glossarbegriffe', () => {
    const terms = extractGlossaryTerms(BLATT_TEXT)
    expect(terms).toContain('Transpiration')
    expect(terms).toContain('Blattader')
    expect(terms.length).toBeGreaterThanOrEqual(6)
    expect(detectGlossaryTask(BLATT_TEXT)?.kind).toBe('glossary')
  })

  it('segmentiert mehrere Teilaufgaben', () => {
    const tasks = detectWorksheetTasks(BLATT_TEXT)
    expect(tasks.some((t) => t.kind === 'image_labeling')).toBe(true)
    expect(tasks.some((t) => t.kind === 'glossary')).toBe(true)
    const open = tasks.filter((t) => t.kind === 'open_ended')
    expect(open).toHaveLength(3)
    expect(open.some((t) =>
      /warum haben sie/i.test(t.instruction) && /bei Hitze Wasser sparen/i.test(t.instruction),
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
      documentText: BLATT_TEXT,
      pdfBlanks: [fakeGap],
    })
    expect(plan.fillMode).toBe('offen')
    expect(plan.tasks.some((t) => t.kind === 'cloze')).toBe(false)
    expect(plan.tasks.some((t) => t.kind === 'matching_inline')).toBe(true)
    expect(plan.tasks.some((t) => t.kind === 'free_text_separate')).toBe(true)
    expect(plan.candidateBank?.candidates.map((c) => c.value)).toEqual([
      'Blattstiel',
      'Blattspreite',
      'Blattader',
      'Oberhaut',
      'Spaltöffnung',
    ])
  })
})
