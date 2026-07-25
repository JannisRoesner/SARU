import { describe, expect, it } from 'vitest'
import {
  filenameBasedSuggestion,
  guessMaterialType,
  titleFromFileName,
} from '../../server/services/bulk-upload/suggest-metadata'

describe('bulk-upload metadata helpers', () => {
  it('leitet Titel aus Dateinamen ab', () => {
    expect(titleFromFileName('AB_Photosynthese-09.pdf')).toBe('AB Photosynthese 09')
    expect(titleFromFileName('klausur final.pdf')).toBe('klausur final')
  })

  it('schätzt Materialarten aus dem Dateinamen', () => {
    expect(guessMaterialType('Lernkontrolle_Kapitel3.pdf')).toBe('lernkontrolle')
    expect(guessMaterialType('Klausur-2024.pdf')).toBe('klausur')
    expect(guessMaterialType('AB-Zellatmung_Loesung.pdf')).toBe('musterloesung')
    expect(guessMaterialType('Folien_Einfuehrung.pdf', 'arbeitsblatt')).toBe('praesentation')
  })

  it('erzeugt Dateiname-basierte Vorschläge ohne KI', () => {
    const vorschlag = filenameBasedSuggestion('AB_Mitose.pdf', 'arbeitsblatt')
    expect(vorschlag.aiUsed).toBe(false)
    expect(vorschlag.title).toBe('AB Mitose')
    expect(vorschlag.materialType).toBe('arbeitsblatt')
    expect(vorschlag.tagNames).toEqual([])
  })
})
