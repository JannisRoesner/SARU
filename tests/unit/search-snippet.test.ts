import { describe, expect, it } from 'vitest'
import { parseSearchSnippet } from '../../shared/utils/search-snippet'

describe('parseSearchSnippet', () => {
  it('erkennt ausschließlich die erzeugten mark-Tags als Hervorhebung', () => {
    expect(parseSearchSnippet('Ein <mark>Treffer</mark> im Text')).toEqual([
      { text: 'Ein ', highlighted: false },
      { text: 'Treffer', highlighted: true },
      { text: ' im Text', highlighted: false },
    ])
  })

  it('belässt fremdes HTML als darzustellenden Text', () => {
    expect(parseSearchSnippet('<img src=x onerror=alert(1)> <script>alert(1)</script>')).toEqual([
      {
        text: '<img src=x onerror=alert(1)> <script>alert(1)</script>',
        highlighted: false,
      },
    ])
  })
})
