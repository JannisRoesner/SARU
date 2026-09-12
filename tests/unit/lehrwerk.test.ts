import { describe, expect, it } from 'vitest'
import { gruppiereLehrwerkInhalt } from '../../shared/utils/lehrwerk'
import { materialPfad } from '../../shared/utils/material-pfad'
import { relationAnzeigeLabel } from '../../shared/utils/labels'

describe('Lehrwerk-Hilfen', () => {
  it('führt Lehrwerke auf die Hub-Route', () => {
    expect(materialPfad({ id: 'lw-1', materialType: 'lehrwerk' })).toBe('/lehrwerke/lw-1')
    expect(materialPfad({ id: 'ab-1', materialType: 'arbeitsblatt' })).toBe('/materialien/ab-1')
    expect(materialPfad({ id: 'x' })).toBe('/materialien/x')
  })

  it('nennt eingehendes gehört-zu „Enthält“', () => {
    expect(relationAnzeigeLabel('gehoert_zu', 'eingehend')).toBe('Enthält')
    expect(relationAnzeigeLabel('gehoert_zu', 'ausgehend')).toBe('Gehört zu')
    expect(relationAnzeigeLabel('musterloesung', 'eingehend')).toBe('Musterlösung')
  })

  it('gruppiert zugeordnete Materialien nach Art', () => {
    const gruppen = gruppiereLehrwerkInhalt([
      { id: '1', materialType: 'loesungsbuch' },
      { id: '2', materialType: 'arbeitsblatt' },
      { id: '3', materialType: 'klausur' },
      { id: '4', materialType: 'notiz' },
      { id: '5', materialType: 'zusatzmaterial' },
    ])

    expect(gruppen.map((g) => g.id)).toEqual(['lehrerband', 'kopiervorlagen', 'pruefung', 'weiteres'])
    expect(gruppen[0]!.eintraege.map((e) => e.id)).toEqual(['1', '5'])
    expect(gruppen.find((g) => g.id === 'weiteres')!.eintraege.map((e) => e.id)).toEqual(['4'])
  })

  it('lässt leere Gruppen weg', () => {
    const gruppen = gruppiereLehrwerkInhalt([{ id: '1', materialType: 'bild' }])
    expect(gruppen).toHaveLength(1)
    expect(gruppen[0]!.id).toBe('medien')
  })
})
