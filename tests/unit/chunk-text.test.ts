import { describe, expect, it } from 'vitest'
import { chunkText } from '../../server/services/search/indexer'

/** Zielgröße plus Überlappung aus dem vorherigen Abschnitt. */
const MAX = 1600 + 200 + 1

describe('chunkText', () => {
  it('lässt kurzen Text unverändert', () => {
    expect(chunkText('  Ein kurzer Text.  ')).toEqual(['Ein kurzer Text.'])
  })

  it('teilt Tabellen und Listen ohne Satzzeichen an Zeilen', () => {
    // So sieht extrahierter PDF-Text von Inhaltsverzeichnissen oder Tabellen aus.
    const zeilen = Array.from({ length: 800 }, (_, i) => `Kapitel ${i} Zellbiologie Seite ${i * 3}`)
    const abschnitte = chunkText(zeilen.join('\n'))

    expect(abschnitte.length).toBeGreaterThan(5)
    expect(Math.max(...abschnitte.map((a) => a.length))).toBeLessThanOrEqual(MAX)
    for (const zeile of [zeilen[0]!, zeilen[400]!, zeilen[799]!]) {
      expect(abschnitte.some((a) => a.includes(zeile))).toBe(true)
    }
  })

  it('teilt auch Fließtext ohne Satzzeichen und Zeilenumbrüche', () => {
    const abschnitte = chunkText(Array.from({ length: 3000 }, (_, i) => `wort${i}`).join(' '))
    expect(Math.max(...abschnitte.map((a) => a.length))).toBeLessThanOrEqual(MAX)
  })

  it('schneidet Zeichenketten ohne jeden Trenner hart', () => {
    const abschnitte = chunkText('x'.repeat(5000))
    expect(abschnitte.length).toBeGreaterThanOrEqual(3)
    expect(Math.max(...abschnitte.map((a) => a.length))).toBeLessThanOrEqual(MAX)
  })
})
