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
    expect(isExtractable('Alt.doc')).toBe(true)
    expect(isExtractable('Folien.pptx')).toBe(true)
    expect(isExtractable('Folien.ppt')).toBe(true)
    expect(isExtractable('Tabelle.xlsx')).toBe(true)
    expect(isExtractable('Tabelle.xls')).toBe(true)
    expect(isExtractable('Text.odt')).toBe(true)
    expect(isExtractable('Praes.odp')).toBe(true)
    expect(isExtractable('Daten.ods')).toBe(true)
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

  it('liest Text und Seitenzahl aus dem Beispiel-PDF', async () => {
    const buffer = await readFile(fixture('sample.pdf'))
    const result = await extractText(buffer, 'sample.pdf')

    expect(result.status).toBe('erfolgreich')
    expect(result.pageCount).toBe(2)
    expect(result.text).toContain('Photosynthese')
    expect(result.text).toContain('Zellteilung')
  })

  it('gibt bei beschädigten Dateien einen Fehlerstatus statt einer Ausnahme zurück', async () => {
    const result = await extractText(Buffer.from('kein echtes PDF'), 'kaputt.pdf')
    expect(result.status).toBe('fehlgeschlagen')
    expect(result.error).toBeTruthy()
  })
})
