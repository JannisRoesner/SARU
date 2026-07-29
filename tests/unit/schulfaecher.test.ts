import { describe, expect, it } from 'vitest'
import {
  HESSEN_SCHULFAECHER,
  normalizeSchulfach,
  normalizeSchulfaecher,
} from '../../shared/utils/schulfaecher'

describe('schulfaecher', () => {
  it('enthält gängige hessische Kernfächer', () => {
    expect(HESSEN_SCHULFAECHER).toContain('Biologie')
    expect(HESSEN_SCHULFAECHER).toContain('Informatik')
    expect(HESSEN_SCHULFAECHER).toContain('Deutsch')
    expect(HESSEN_SCHULFAECHER).toContain('Politik und Wirtschaft')
  })

  it('normalisiert Aliase', () => {
    expect(normalizeSchulfach('Bio')).toBe('Biologie')
    expect(normalizeSchulfach('Info')).toBe('Informatik')
    expect(normalizeSchulfach('Erdkunde')).toBe('Geographie')
    expect(normalizeSchulfach('Politik')).toBe('Politik und Wirtschaft')
  })

  it('lehnt Unterrichtsthemen ab', () => {
    expect(normalizeSchulfach('Objektorientierung')).toBeNull()
    expect(normalizeSchulfach('Photosynthese')).toBeNull()
    expect(normalizeSchulfach('Zellatmung')).toBeNull()
  })

  it('filtert und dedupliziert Fachlisten', () => {
    expect(
      normalizeSchulfaecher(['Informatik', 'info', 'Objektorientierung', 'Biologie']),
    ).toEqual(['Informatik', 'Biologie'])
  })
})
