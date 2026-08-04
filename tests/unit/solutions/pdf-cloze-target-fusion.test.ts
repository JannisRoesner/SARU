import { describe, expect, it } from 'vitest'
import { fusePdfClozeTargets } from '../../../server/services/ai/solutions/pdf-cloze-target-fusion'
import type { PdfBlankRegion } from '../../../server/services/ai/document-fill'
import type { AnswerTarget, CandidateBank } from '../../../server/services/ai/solutions/types'

const pageSize = { width: 600, height: 800 }

function line(id: string, y: number): AnswerTarget {
  return {
    id,
    kind: 'answer_line',
    page: 1,
    bbox: { x: 0.2, y, w: 0.25, h: 0.025 },
    source: 'native',
  }
}

function matchingBlank(blankIndex: number, y: number): PdfBlankRegion {
  return {
    pageIndex: 0,
    blankIndex,
    x: 120,
    y: (1 - y) * pageSize.height - 14,
    width: 150,
    height: 20,
    kind: 'gap',
    leftText: `links ${blankIndex}`,
    rightText: `rechts ${blankIndex}`,
  }
}

function bank(size: number): CandidateBank {
  return {
    id: 'bank',
    candidates: Array.from({ length: size }, (_, index) => ({
      id: `c${index}`,
      value: `Wort ${index}`,
      normalized: `wort ${index}`,
    })),
    reusePolicy: 'once',
    source: 'wordlist_section',
  }
}

describe('PDF cloze target fusion', () => {
  it('ergänzt fehlende Textlücken aus deckungsgleichen Linien und Wortliste', () => {
    const lines = [line('line-0', 0.2), line('line-1', 0.3), line('line-2', 0.4)]
    const blanks = [matchingBlank(0, 0.2), matchingBlank(1, 0.3)]
    const result = fusePdfClozeTargets({
      blanks,
      lineTargets: lines,
      candidateBank: bank(3),
      pageSizes: [pageSize],
    })

    expect(result).not.toBeNull()
    expect(result!.matchedBlankCount).toBe(2)
    expect(result!.blanks).toHaveLength(3)
    expect(result!.blanks.map((blank) => blank.blankIndex)).toEqual([0, 1, 2])
    // Bei vorhandener Textebene muss die Satz-Baseline erhalten bleiben;
    // sonst wandert der V2-Overlaytext sichtbar auf oder unter die Zeile.
    expect(result!.blanks[0]!.y).toBe(blanks[0]!.y)
    expect(result!.blanks[1]!.y).toBe(blanks[1]!.y)
    expect(result!.blanks[2]!.y).toBeCloseTo((1 - 0.4) * pageSize.height - 12, 6)
    expect(result!.blanks[2]!.leftText).toBe('')
    expect(result!.consumedLineTargetIds).toEqual(
      new Set(['line-0', 'line-1', 'line-2']),
    )
  })

  it('verschmilzt ohne passende Kandidatenanzahl keine Freitextlinien', () => {
    const result = fusePdfClozeTargets({
      blanks: [matchingBlank(0, 0.2), matchingBlank(1, 0.3)],
      lineTargets: [line('line-0', 0.2), line('line-1', 0.3), line('line-2', 0.4)],
      candidateBank: bank(2),
      pageSizes: [pageSize],
    })

    expect(result).toBeNull()
  })
})
