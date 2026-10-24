import { describe, expect, it } from 'vitest'
import { parseByteRange } from '../../server/utils/byte-range'

describe('parseByteRange', () => {
  it('liefert ohne oder mit unbekanntem Header die ganze Datei', () => {
    expect(parseByteRange(undefined, 100)).toBeNull()
    expect(parseByteRange('items=0-5', 100)).toBeNull()
    expect(parseByteRange('bytes=0-5,10-20', 100)).toBeNull()
    expect(parseByteRange('bytes=-', 100)).toBeNull()
  })

  it('wertet offene und geschlossene Bereiche aus', () => {
    expect(parseByteRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
    expect(parseByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseByteRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 })
  })

  it('wertet Suffix-Bereiche aus', () => {
    expect(parseByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseByteRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 })
  })

  it('meldet Bereiche außerhalb der Datei als ungültig', () => {
    expect(parseByteRange('bytes=100-', 100)).toBe('ungueltig')
    expect(parseByteRange('bytes=20-10', 100)).toBe('ungueltig')
    expect(parseByteRange('bytes=-0', 100)).toBe('ungueltig')
    expect(parseByteRange('bytes=0-', 0)).toBe('ungueltig')
  })
})
