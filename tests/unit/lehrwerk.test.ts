import { describe, expect, it } from 'vitest'
import { gruppiereLehrwerkInhalt } from '../../shared/utils/lehrwerk'
import { materialPfad, materialZurueckZiel } from '../../shared/utils/material-pfad'
import { relationAnzeigeLabel } from '../../shared/utils/labels'

describe('Lehrwerk-Hilfen', () => {
  it('führt Lehrwerke auf die Hub-Route', () => {
    expect(materialPfad({ id: 'lw-1', materialType: 'lehrwerk' })).toBe('/lehrwerke/lw-1')
    expect(materialPfad({ id: 'ab-1', materialType: 'arbeitsblatt' })).toBe('/materialien/ab-1')
    expect(materialPfad({ id: 'x' })).toBe('/materialien/x')
    expect(
      materialPfad(
        { id: 'ab-1', materialType: 'arbeitsblatt' },
        { lehrwerkId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      ),
    ).toBe('/materialien/ab-1?lehrwerk=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
  })

  it('führt vom zugeordneten Material zurück zum Lehrwerk', () => {
    const lw = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    expect(
      materialZurueckZiel({
        materialType: 'arbeitsblatt',
        relations: [
          {
            relationType: 'gehoert_zu',
            direction: 'ausgehend',
            material: { id: lw, title: 'Natura', materialType: 'lehrwerk' },
          },
        ],
      }),
    ).toEqual({ to: `/lehrwerke/${lw}`, label: 'Lehrwerk' })

    expect(
      materialZurueckZiel({
        materialType: 'arbeitsblatt',
        queryLehrwerkId: lw,
      }),
    ).toEqual({ to: `/lehrwerke/${lw}`, label: 'Lehrwerk' })

    expect(materialZurueckZiel({ materialType: 'arbeitsblatt' })).toEqual({
      to: '/materialien',
      label: 'Materialien',
    })
    expect(materialZurueckZiel({ materialType: 'lehrwerk' })).toEqual({
      to: '/lehrwerke',
      label: 'Lehrwerke',
    })
  })

  it('nennt eingehendes gehört-zu „Enthält“', () => {
    expect(relationAnzeigeLabel('gehoert_zu', 'eingehend')).toBe('Enthält')
    expect(relationAnzeigeLabel('gehoert_zu', 'ausgehend')).toBe('Gehört zu')
    expect(relationAnzeigeLabel('musterloesung', 'eingehend')).toBe('Musterlösung')
  })

  it('gruppiert zugeordnete Materialien und hält Serviceband oben', () => {
    const gruppen = gruppiereLehrwerkInhalt([
      { id: '1', materialType: 'loesungsbuch' },
      { id: '2', materialType: 'arbeitsblatt' },
      { id: '3', materialType: 'klausur' },
      { id: '4', materialType: 'notiz' },
      { id: '5', materialType: 'zusatzmaterial', title: 'Versuch Katalase' },
      { id: '6', materialType: 'serviceband' },
    ])

    expect(gruppen.map((g) => g.id)).toEqual([
      'serviceband',
      'loesungen',
      'versuche',
      'kopiervorlagen',
      'pruefung',
      'weiteres',
    ])
    expect(gruppen[0]!.eintraege.map((e) => e.id)).toEqual(['6'])
    expect(gruppen.find((g) => g.id === 'versuche')!.eintraege.map((e) => e.id)).toEqual(['5'])
    expect(gruppen.find((g) => g.id === 'loesungen')!.eintraege.map((e) => e.id)).toEqual(['1'])
    expect(gruppen.find((g) => g.id === 'weiteres')!.eintraege.map((e) => e.id)).toEqual(['4'])
  })

  it('ordnet ein Material mehreren Gruppen zu, wenn Typ und Titel passen', () => {
    const gruppen = gruppiereLehrwerkInhalt([
      { id: 'ab', materialType: 'arbeitsblatt', title: 'Versuch Katalase' },
      { id: 'gfb', materialType: 'gefaehrdungsbeurteilung', title: 'GFB Versuch Katalase' },
    ])

    expect(gruppen.find((g) => g.id === 'versuche')!.eintraege.map((e) => e.id)).toEqual(['ab', 'gfb'])
    expect(gruppen.find((g) => g.id === 'kopiervorlagen')!.eintraege.map((e) => e.id)).toEqual(['ab'])
    expect(gruppen.find((g) => g.id === 'labor')!.eintraege.map((e) => e.id)).toEqual(['gfb'])
  })

  it('erkennt Serviceband und Lösungen auch am Titel', () => {
    const gruppen = gruppiereLehrwerkInhalt([
      { id: 'sb', materialType: 'zusatzmaterial', title: 'Natura Serviceband EF' },
      { id: 'lh', materialType: 'notiz', title: 'Lösungsheft komplett' },
    ])

    expect(gruppen.map((g) => g.id)).toEqual(['serviceband', 'loesungen', 'versuche'])
    expect(gruppen.find((g) => g.id === 'serviceband')!.eintraege.map((e) => e.id)).toEqual(['sb'])
    expect(gruppen.find((g) => g.id === 'loesungen')!.eintraege.map((e) => e.id)).toEqual(['lh'])
    expect(gruppen.find((g) => g.id === 'versuche')!.eintraege.map((e) => e.id)).toEqual(['sb'])
  })

  it('lässt leere Gruppen weg', () => {
    const gruppen = gruppiereLehrwerkInhalt([{ id: '1', materialType: 'bild' }])
    expect(gruppen).toHaveLength(1)
    expect(gruppen[0]!.id).toBe('medien')
  })
})
