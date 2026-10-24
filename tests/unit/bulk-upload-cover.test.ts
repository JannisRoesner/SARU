import { describe, expect, it } from 'vitest'
import { findLehrwerkCover, isLehrwerkCoverFile } from '../../server/services/bulk-upload/pairing'

const file = (relativePath: string) => {
  const fileName = relativePath.split('/').pop()!
  return { sourceRef: relativePath, fileName, relativePath, extension: fileName.split('.').pop()! }
}

describe('isLehrwerkCoverFile', () => {
  it.each(['cover.png', 'Cover.JPG', 'COVER.jpeg', 'cover.webp', 'Cover - Linder Biologie.png', 'cover_1.jpg'])(
    'erkennt %s',
    (name) => expect(isLehrwerkCoverFile(name)).toBe(true),
  )

  it.each(['cover.pdf', 'cover.gif', 'discover.png', 'coverage.png', 'Abbildung cover.png', 'cover', '.png'])(
    'ignoriert %s',
    (name) => expect(isLehrwerkCoverFile(name)).toBe(false),
  )
})

describe('findLehrwerkCover', () => {
  it('liefert null ohne Cover-Bild', () => {
    expect(findLehrwerkCover([file('Lehrwerk/AB1 - Zelle.pdf'), file('Lehrwerk/bild.png')])).toBeNull()
  })

  it('findet das Cover in der Lehrwerk-Wurzel', () => {
    const cover = findLehrwerkCover([
      file('CD/Arbeitsblätter/AB1 - Zelle.pdf'),
      file('CD/cover.png'),
      file('CD/Interaktive Animationen/anim.swf'),
    ])
    expect(cover?.sourceRef).toBe('CD/cover.png')
  })

  it('bevorzugt das höchste Cover und bei Gleichstand den alphabetisch ersten Pfad', () => {
    expect(
      findLehrwerkCover([file('CD/Material/cover.png'), file('CD/Cover.jpg')])?.sourceRef,
    ).toBe('CD/Cover.jpg')
    expect(findLehrwerkCover([file('B/cover.png'), file('A/cover.png')])?.sourceRef).toBe('A/cover.png')
  })

  it('verarbeitet Windows-Pfade und Dateien ohne Ordner', () => {
    expect(findLehrwerkCover([{ ...file('x/cover.png'), relativePath: `x${String.fromCharCode(92)}cover.png` }])?.fileName).toBe('cover.png')
    expect(findLehrwerkCover([{ sourceRef: 'a', fileName: 'cover.webp', extension: 'webp' }])?.sourceRef).toBe('a')
  })
})
