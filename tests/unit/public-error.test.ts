import { describe, expect, it } from 'vitest'
import {
  istTechnischeMeldung,
  kiAnbieterFehlermeldung,
  oeffentlicheFehlermeldung,
} from '#shared/utils/public-error'

describe('public-error', () => {
  it('erkennt technische Meldungen', () => {
    expect(istTechnischeMeldung('Failed query: select * from users')).toBe(true)
    expect(istTechnischeMeldung('ECONNREFUSED')).toBe(true)
    expect(istTechnischeMeldung('NICHT_ANGEMELDET')).toBe(true)
    expect(istTechnischeMeldung('')).toBe(true)
  })

  it('lässt verständliche Meldungen durch', () => {
    expect(istTechnischeMeldung('E-Mail-Adresse oder Passwort ist nicht korrekt.')).toBe(false)
    expect(istTechnischeMeldung('Die Datei ist leer.')).toBe(false)
  })

  it('nutzt App-Fehler mit lesbarem Text', () => {
    const error = { statusCode: 422, message: 'Die Eingabe ist ungültig.' }
    expect(oeffentlicheFehlermeldung(error, 'Fallback')).toBe('Die Eingabe ist ungültig.')
  })

  it('ersetzt technische App-Fehler durch Fallback', () => {
    const error = { statusCode: 422, message: 'Failed query: select 1' }
    expect(oeffentlicheFehlermeldung(error, 'Bitte erneut versuchen.')).toBe('Bitte erneut versuchen.')
  })

  it('ersetzt rohe Exceptions durch Fallback', () => {
    expect(
      oeffentlicheFehlermeldung(new Error('ENOENT: no such file'), 'Import fehlgeschlagen.'),
    ).toBe('Import fehlgeschlagen.')
  })

  it('formuliert KI-Anbieterfehler verständlich', () => {
    expect(kiAnbieterFehlermeldung(401, 'Die Anfrage')).toContain('Administration')
    expect(kiAnbieterFehlermeldung(429, 'Die Anfrage')).toContain('zu viele Anfragen')
    expect(kiAnbieterFehlermeldung(502, 'Die Anfrage')).toContain('nicht zuverlässig')
  })
})
