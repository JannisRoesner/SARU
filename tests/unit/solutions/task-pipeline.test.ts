import { describe, expect, it } from 'vitest'
import { analyzeDocument } from '../../../server/services/ai/solutions/document-analyzer'
import { classifyTasks } from '../../../server/services/ai/solutions/task-classifier'
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
    // Die kanonische V2-Planung rendert direkt aus diesen Targets; sie dürfen
    // nicht mehr auf dem alten Platzhalter (0, 0) liegen.
    expect(cloze.targets[0]!.bbox?.x).toBeGreaterThan(0.08)
    expect(cloze.targets[0]!.bbox?.y).toBeGreaterThan(0.4)
  })

  it('erkennt offene Aufgabe ohne Lücken als free_text_separate', () => {
    const text =
      'Beschreiben Sie die in der GUI dargestellten Komponenten im Sachzusammenhang.\nMaterial zum Nachtflugverbot.'
    const doc = analyzeDocument({ fullText: text })
    const tasks = classifyTasks(segmentTasks({ document: doc }))
    expect(tasks.some((t) => t.kind === 'free_text_separate')).toBe(true)
  })

  it('markiert fehlende Wortliste bei Cloze als expected_but_missing', () => {
    const text = `
Fülle die Lücken mit Wörtern aus der Wortliste.
Die ___ des Penis …
`
    const blanks = Array.from({ length: 9 }, (_, i) => blank(i, `left${i}`, `right${i}`))
    const doc = analyzeDocument({ fullText: text, pdfBlanks: blanks })
    const tasks = classifyTasks(segmentTasks({ document: doc, pdfBlanks: blanks }))
    const cloze = tasks.find((t) => t.kind === 'cloze')!
    expect(cloze.candidateBank).toBeUndefined()
    expect(cloze.candidateBankStatus).toBe('expected_but_missing')
    expect(cloze.requiresCandidateBankRepair).toBe(true)
    expect(cloze.confidence).toBeLessThan(0.9)
    expect(cloze.evidence).toContain('candidate bank expected but missing')
  })

  it('markiert unplausible Wortliste (2 Zeilen statt 9 Begriffe) als malformed', () => {
    const text = `
Wortliste:
Eichel / Erektion / Hautschichten / lang / Nervenenden /
Schleimhaut / Spitze / unterschiedlich / Unterseite
Fülle die Lücken mit Wörtern aus der Wortliste.
Die ___ des Penis …
`
    const blanks = Array.from({ length: 9 }, (_, i) => blank(i, `left${i}`, `right${i}`))
    // Simuliere den alten Extraktionsfehler: zwei unzerlegte Zeilen.
    const badBank = {
      id: 'bank-1',
      candidates: [
        {
          id: 'c0',
          value: 'Eichel / Erektion / Hautschichten / lang / Nervenenden /',
          normalized: 'eichel / erektion / hautschichten / lang / nervenenden /',
        },
        {
          id: 'c1',
          value: 'Schleimhaut / Spitze / unterschiedlich / Unterseite',
          normalized: 'schleimhaut / spitze / unterschiedlich / unterseite',
        },
      ],
      reusePolicy: 'repeatable' as const,
      source: 'wordlist_section' as const,
    }
    const doc = analyzeDocument({ fullText: text, pdfBlanks: blanks })
    const tasks = classifyTasks(
      segmentTasks({ document: doc, pdfBlanks: blanks, candidateBank: badBank }),
    )
    const cloze = tasks.find((t) => t.kind === 'cloze')!
    expect(cloze.candidateBankStatus).toBe('malformed')
    expect(cloze.requiresCandidateBankRepair).toBe(true)
    expect(cloze.evidence.some((e) => e.includes('malformed'))).toBe(true)
  })
})
