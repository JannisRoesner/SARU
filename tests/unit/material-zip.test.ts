import { describe, expect, it } from 'vitest'
import { eindeutigerName } from '../../server/services/material-zip.service'
import { materialPfad, materialZurueckZiel } from '../../shared/utils/material-pfad'

const LZ = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const LW = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

describe('ZIP-Dateinamen', () => {
  it('vergibt doppelte Namen nur einmal', () => {
    const belegt = new Set<string>()
    expect(eindeutigerName('Station 1.pdf', belegt)).toBe('Station 1.pdf')
    expect(eindeutigerName('station 1.pdf', belegt)).toBe('station 1 (2).pdf')
    expect(eindeutigerName('Station 1.pdf', belegt)).toBe('Station 1 (3).pdf')
    expect(eindeutigerName('Lösungen/Station 1.pdf', belegt)).toBe('Lösungen/Station 1.pdf')
  })
})

describe('Rückweg aus dem Lernzirkel', () => {
  it('hängt den Lernzirkel an den Link', () => {
    expect(materialPfad({ id: 'ab', materialType: 'arbeitsblatt' }, { lernzirkelId: LZ, lehrwerkId: LW }))
      .toBe(`/materialien/ab?lernzirkel=${LZ}`)
  })

  it('bevorzugt den Lernzirkel vor dem Lehrwerk', () => {
    const relations = [
      { relationType: 'gehoert_zu', direction: 'ausgehend', material: { id: LW, title: 'LW', materialType: 'lehrwerk' } },
      { relationType: 'gehoert_zu', direction: 'ausgehend', material: { id: LZ, title: 'LZ', materialType: 'lernzirkel' } },
    ]
    expect(materialZurueckZiel({ materialType: 'arbeitsblatt', relations, queryLernzirkelId: LZ }).to)
      .toBe(`/materialien/${LZ}`)
    expect(materialZurueckZiel({ materialType: 'arbeitsblatt', relations }).to).toBe(`/lehrwerke/${LW}`)
  })
})
