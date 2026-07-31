import { describe, expect, it } from 'vitest'
import { analyzeDocument } from '../../../server/services/ai/solutions/document-analyzer'
import { classifyTasks, legacyFillModeFromTasks } from '../../../server/services/ai/solutions/task-classifier'
import { segmentTasks } from '../../../server/services/ai/solutions/task-segmenter'
import { extractCandidateBank } from '../../../server/services/ai/solutions/candidate-bank'
import type { PdfBlankRegion } from '../../../server/services/ai/document-fill'

function blank(i: number, left: string, right: string): PdfBlankRegion {
  return {
    pageIndex: 0,
    blankIndex: i,
    x: 50 + i * 10,
    y: 400 - i * 20,
    width: 80,
    height: 12,
    kind: 'gap',
    leftText: left,
    rightText: right,
  }
}

describe('task segmenter / classifier', () => {
  it('erkennt Cloze-Task mit Wortliste und 9 Lücken', () => {
    const text = `
Wortliste: Spitze, unterschiedlich, lang, Hautschichten, Schleimhaut, Erektion, Nervenenden, Unterseite, Eichel
Fülle die Lücken.
Die ___ des Penis …
`
    const blanks = Array.from({ length: 9 }, (_, i) => blank(i, `left${i}`, `right${i}`))
    const bank = extractCandidateBank(text, 9)
    const doc = analyzeDocument({ fullText: text, pdfBlanks: blanks })
    const tasks = classifyTasks(
      segmentTasks({ document: doc, pdfBlanks: blanks, candidateBank: bank }),
    )
    expect(tasks.some((t) => t.kind === 'cloze')).toBe(true)
    const cloze = tasks.find((t) => t.kind === 'cloze')!
    expect(cloze.targets).toHaveLength(9)
    expect(cloze.candidateBank?.candidates.length).toBe(9)
    expect(cloze.renderMode).toBe('overlay')
    expect(cloze.confidence).toBeGreaterThanOrEqual(0.9)
    expect(legacyFillModeFromTasks(tasks)).toBe('lueckentext')
  })

  it('erkennt offene Aufgabe ohne Lücken als free_text_separate', () => {
    const text =
      'Beschreiben Sie die in der GUI dargestellten Komponenten im Sachzusammenhang.\nMaterial zum Nachtflugverbot.'
    const doc = analyzeDocument({ fullText: text })
    const tasks = classifyTasks(segmentTasks({ document: doc }))
    expect(tasks.some((t) => t.kind === 'free_text_separate')).toBe(true)
    expect(legacyFillModeFromTasks(tasks)).toBe('offen')
  })
})
