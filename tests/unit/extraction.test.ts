import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  extractText,
  isExtractable,
  normalizeDiacritics,
} from '../../server/services/extraction.service'

const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))

describe('normalizeDiacritics', () => {
  it('setzt getrennte Akzentzeichen zu deutschen Umlauten zusammen', () => {
    expect(normalizeDiacritics('Gef¨uhle')).toBe('Gefühle')
    expect(normalizeDiacritics('Gef¨ uhle')).toBe('Gefühle')
    expect(normalizeDiacritics('Sexualit¨at')).toBe('Sexualität')
    expect(normalizeDiacritics('k¨onnen')).toBe('können')
    expect(normalizeDiacritics('¨Uberblick')).toBe('Überblick')
  })

  it('lässt korrekt kodierten Text unverändert', () => {
    const text = 'Größe, Bevölkerung und Übung – alles bereits korrekt.'
    expect(normalizeDiacritics(text)).toBe(text)
  })

  it('normalisiert kombinierende Zeichen zur NFC-Form', () => {
    // "u" + kombinierendes Trema soll zu einem einzelnen Zeichen werden.
    expect(normalizeDiacritics('u\u0308ben')).toBe('üben')
  })
})

describe('isExtractable', () => {
  it('erkennt unterstützte Dokumentformate', () => {
    expect(isExtractable('Arbeitsblatt.pdf')).toBe(true)
    expect(isExtractable('Entwurf.DOCX')).toBe(true)
    expect(isExtractable('Folien.pptx')).toBe(true)
  })

  it('lehnt nicht indizierbare Formate ab', () => {
    expect(isExtractable('Foto.png')).toBe(false)
    expect(isExtractable('Film.mp4')).toBe(false)
    expect(isExtractable('ohne-endung')).toBe(false)
  })
})

describe('extractText', () => {
  it('meldet nicht unterstützte Formate, ohne zu scheitern', async () => {
    const result = await extractText(Buffer.from('egal'), 'bild.png')
    expect(result.status).toBe('nicht_unterstuetzt')
    expect(result.text).toBe('')
  })

  it('liest einfache Textdateien', async () => {
    const result = await extractText(Buffer.from('Hallo Welt', 'utf8'), 'notiz.txt')
    expect(result.status).toBe('erfolgreich')
    expect(result.text).toBe('Hallo Welt')
  })

  it('liest Text und Seitenzahl aus einem echten PDF des Beispielexports', async () => {
    const buffer = await readFile(fixture('AB1-Sexuelle-Vielfalt.pdf'))
    const result = await extractText(buffer, 'AB1-Sexuelle-Vielfalt.pdf')

    expect(result.status).toBe('erfolgreich')
    expect(result.pageCount).toBe(2)
    expect(result.text).toContain('Sexuelle Vielfalt')
    // Umlaute müssen korrekt zusammengesetzt sein, sonst schlägt die Suche fehl.
    expect(result.text).toContain('Gefühle')
    expect(result.text).not.toContain('¨')
  })

  it('verbindet am Zeilenende getrennte Wörter wieder', async () => {
    const buffer = await readFile(fixture('AB1-Sexuelle-Vielfalt.pdf'))
    const result = await extractText(buffer, 'AB1-Sexuelle-Vielfalt.pdf')

    expect(result.text).toContain('ausdrücken')
    expect(result.text).not.toMatch(/aus-\s*\n?\s*drücken/)
  })

  it('gibt bei beschädigten Dateien einen Fehlerstatus statt einer Ausnahme zurück', async () => {
    const result = await extractText(Buffer.from('kein echtes PDF'), 'kaputt.pdf')
    expect(result.status).toBe('fehlgeschlagen')
    expect(result.error).toBeTruthy()
  })
})
