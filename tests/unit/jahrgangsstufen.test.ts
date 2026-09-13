import { describe, expect, it } from 'vitest'
import {
  formatJahrgaenge,
  gradeLevelFromStorage,
  gradeLevelToStorage,
  gradeLevelsFromOberstufeHint,
  guessGradeLevelsFromFileName,
  jahrgangsstufeLabel,
  mapLegacyOberstufeToCurrent,
  normalizeGradeLevel,
  normalizeGradeLevels,
  sortGradeLevels,
} from '#shared/utils/jahrgangsstufen'

describe('jahrgangsstufen', () => {
  it('speichert und liest numerische Stufen', () => {
    expect(gradeLevelToStorage(5)).toBe('5')
    expect(gradeLevelFromStorage('5')).toBe(5)
    expect(gradeLevelFromStorage(5)).toBe(5)
  })

  it('speichert und liest Hessische Oberstufen-Codes', () => {
    for (const code of ['E1', 'E2', 'Q1', 'Q2', 'Q3', 'Q4'] as const) {
      expect(gradeLevelToStorage(code)).toBe(code)
      expect(gradeLevelFromStorage(code)).toBe(code)
      expect(gradeLevelFromStorage(code.toLowerCase())).toBe(code)
    }
  })

  it('liest Legacy-Oberstufen 11–13', () => {
    expect(gradeLevelFromStorage(11)).toBe('11')
    expect(gradeLevelFromStorage('12')).toBe('12')
    expect(gradeLevelFromStorage(13)).toBe('13')
  })

  it('lehnt ungültige Werte ab', () => {
    expect(normalizeGradeLevel(0)).toBeNull()
    expect(normalizeGradeLevel(14)).toBeNull()
    expect(normalizeGradeLevel('Q5')).toBeNull()
    expect(normalizeGradeLevel('')).toBeNull()
  })

  it('sortiert Oberstufe nach E- und Q-Phase', () => {
    expect(sortGradeLevels(['Q2', 'E2', 9, 'E1', 'Q1'])).toEqual([9, 'E1', 'E2', 'Q1', 'Q2'])
  })

  it('formatiert numerische Bereiche und Oberstufe', () => {
    expect(formatJahrgaenge([5, 6, 7])).toBe('5–7')
    expect(formatJahrgaenge(['E1', 'E2', 'Q1'])).toBe('E1, E2, Q1')
    expect(formatJahrgaenge([9, 'E1', 'Q3'])).toBe('9, E1, Q3')
  })

  it('kennzeichnet Legacy-Stufen in Labels', () => {
    expect(jahrgangsstufeLabel('11')).toBe('11. Klasse (alt)')
    expect(jahrgangsstufeLabel('E1')).toBe('E1')
    expect(jahrgangsstufeLabel(8)).toBe('8. Klasse')
  })

  it('normalisiert Arrays dedupliziert', () => {
    expect(normalizeGradeLevels(['E1', 'e1', 5, 5, 'Q4'])).toEqual([5, 'E1', 'Q4'])
  })

  it('erkennt Jahrgangsstufen im Dateinamen', () => {
    expect(guessGradeLevelsFromFileName('Biologie_8_Schuelerbuch.pdf')).toEqual([8])
    expect(guessGradeLevelsFromFileName('Klasse 9 Bio.pdf')).toEqual([9])
    expect(guessGradeLevelsFromFileName('8. Klasse Photosynthese.pdf')).toEqual([8])
    expect(guessGradeLevelsFromFileName('Bio-E1-Klausur.pdf')).toEqual(['E1'])
    expect(guessGradeLevelsFromFileName('Q2 Arbeitsblatt.docx')).toEqual(['Q2'])
    expect(guessGradeLevelsFromFileName('Klasse 08 Natura.pdf')).toEqual([8])
    expect(guessGradeLevelsFromFileName('Klasse 11 Bio.pdf')).toEqual(['E1', 'E2'])
    expect(guessGradeLevelsFromFileName('Bio_Einfuehrungsphase.pdf')).toEqual(['E1', 'E2'])
    expect(guessGradeLevelsFromFileName('LK Qualifikationsphase.pdf')).toEqual(['Q1', 'Q2', 'Q3', 'Q4'])
    expect(guessGradeLevelsFromFileName('E-Phase Klausur.pdf')).toEqual(['E1', 'E2'])
  })

  it('mappt Phasenbegriffe und Legacy-Oberstufe', () => {
    expect(gradeLevelsFromOberstufeHint('Klausur Einführungsphase')).toEqual(['E1', 'E2'])
    expect(gradeLevelsFromOberstufeHint('Material zur Q-Phase')).toEqual(['Q1', 'Q2', 'Q3', 'Q4'])
    expect(mapLegacyOberstufeToCurrent('11')).toEqual(['E1', 'E2'])
    expect(mapLegacyOberstufeToCurrent('12')).toEqual(['Q1', 'Q2'])
    expect(mapLegacyOberstufeToCurrent('13')).toEqual(['Q3', 'Q4'])
    expect(mapLegacyOberstufeToCurrent(8)).toEqual([8])
  })

  it('verwirrt Kapitel- und Jahreszahlen nicht mit der Jahrgangsstufe', () => {
    expect(guessGradeLevelsFromFileName('AB_Photosynthese-09.pdf')).toEqual([])
    expect(guessGradeLevelsFromFileName('AB_Mitose.pdf')).toEqual([])
    expect(guessGradeLevelsFromFileName('Klausur-2024.pdf')).toEqual([])
    expect(guessGradeLevelsFromFileName('Schuelerbuch_Band2.pdf')).toEqual([])
  })
})
