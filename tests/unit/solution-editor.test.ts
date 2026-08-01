import { describe, expect, it } from 'vitest'
import {
  istOverlayAntwort,
  overlayBboxVon,
  solutionEditorBackgroundAssetId,
  solutionEditorMode,
} from '../../shared/utils/solution-editor'
import type { StoredSolutionAnswer } from '../../server/database/schema/materials'

function antwort(partial: Partial<StoredSolutionAnswer>): StoredSolutionAnswer {
  return {
    id: '1',
    label: 'A',
    answer: 'Text',
    ...partial,
  }
}

describe('solutionEditorMode', () => {
  it('mappt fillStrategy auf Editor-Modus', () => {
    expect(solutionEditorMode('pdf_overlay')).toBe('overlay')
    expect(solutionEditorMode('pdf_separate')).toBe('appendix')
    expect(solutionEditorMode('pdf_hybrid')).toBe('hybrid')
    expect(solutionEditorMode('docx_inplace')).toBeNull()
  })
})

describe('solutionEditorBackgroundAssetId', () => {
  it('pdf_separate/appendix nutzt niemals das Quell-PDF als Hintergrund', () => {
    expect(
      solutionEditorBackgroundAssetId('appendix', 'solution-asset', 'source-asset'),
    ).toBe('solution-asset')
    expect(solutionEditorBackgroundAssetId('appendix', 'solution-asset', null)).toBe(
      'solution-asset',
    )
  })

  it('overlay/hybrid bevorzugen das Quell-PDF', () => {
    expect(
      solutionEditorBackgroundAssetId('overlay', 'solution-asset', 'source-asset'),
    ).toBe('source-asset')
    expect(
      solutionEditorBackgroundAssetId('hybrid', 'solution-asset', 'source-asset'),
    ).toBe('source-asset')
  })
})

describe('overlayBboxVon', () => {
  it('erzeugt keine Default-bbox für freitext ohne Position (pdf_separate)', () => {
    expect(
      overlayBboxVon(
        antwort({ fieldType: 'freitext', blankIndex: null, bbox: null }),
      ),
    ).toBeNull()
  })

  it('liefert Fallback-Box nur für platzierte Overlay-Antworten', () => {
    expect(overlayBboxVon(antwort({ blankIndex: 0, fieldType: 'luecke' }))).toEqual({
      x: 0.35,
      y: 0.2,
      w: 0.28,
      h: 0.028,
    })
    expect(
      overlayBboxVon(
        antwort({
          fieldType: 'freitext',
          bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
        }),
      ),
    ).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.1 })
  })
})

describe('istOverlayAntwort', () => {
  it('appendix: keine Overlay-Antworten', () => {
    expect(istOverlayAntwort(antwort({ fieldType: 'freitext' }), 'appendix')).toBe(false)
    expect(istOverlayAntwort(antwort({ blankIndex: 0 }), 'appendix')).toBe(false)
  })

  it('overlay: nur geometrisch platzierte Antworten', () => {
    expect(istOverlayAntwort(antwort({ fieldType: 'freitext' }), 'overlay')).toBe(false)
    expect(istOverlayAntwort(antwort({ blankIndex: 1, fieldType: 'luecke' }), 'overlay')).toBe(
      true,
    )
  })

  it('hybrid: nur platzierte Lücken', () => {
    expect(istOverlayAntwort(antwort({ blankIndex: 2, fieldType: 'luecke' }), 'hybrid')).toBe(true)
    expect(istOverlayAntwort(antwort({ fieldType: 'freitext', blankIndex: null }), 'hybrid')).toBe(
      false,
    )
  })
})
