import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { html5Startseite, interaktivFormat, istInteraktivDatei } from '../../shared/utils/interaktiv'
import { isBulkMaterialFileName } from '../../shared/utils/ai-material-formats'
import { guessMaterialType } from '../../shared/utils/material-type-guess'
import { expandBulkArchives } from '../../server/services/bulk-upload/zip'
import {
  html5BuehneAus,
  html5Inhaltstyp,
  html5Schluessel,
  pruefeHtml5Paket,
  pruefeHtml5Schluessel,
} from '../../server/services/html5-paket.service'

const ID = '7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f'

function tafelbild(): Buffer {
  return Buffer.from(
    zipSync({
      'k02_s046/index.html': strToU8('<!doctype html><script src="js/main.js"></script>'),
      'k02_s046/js/main.js': strToU8('console.log(1)'),
      'k02_s046/img/bg.png': strToU8('png'),
    }),
  )
}

describe('HTML5-Pakete', () => {
  it('erkennt die doppelte Endung, gewöhnliche ZIPs nicht', () => {
    expect(interaktivFormat('Bau des Herzens.html5.zip')).toBe('html5')
    expect(interaktivFormat('Animation.SWF')).toBe('swf')
    expect(interaktivFormat('Kopiervorlagen.zip')).toBeNull()
    expect(istInteraktivDatei('Tafelbilder/Herz.HTML5.ZIP')).toBe(true)
    expect(guessMaterialType('Tafelbilder/Herz.html5.zip')).toBe('interaktiv')
    expect(isBulkMaterialFileName('Tafelbilder/Herz.html5.zip')).toBe(true)
  })

  it('findet die Startseite wie in den Klett-Paketen', () => {
    expect(html5Startseite(['a/index.html', 'a/js/main.js'])).toBe('a/index.html')
    expect(html5Startseite(['a/b/pbni02ov201.html', 'a/b/content.js'])).toBe('a/b/pbni02ov201.html')
    expect(html5Startseite(['index.html', 'hilfe/index.html'])).toBe('index.html')
    expect(html5Startseite(['eins.html', 'zwei.html'])).toBeNull()
    expect(html5Startseite(['a/index.html', 'b/index.html'])).toBeNull()
    expect(html5Startseite(['bild.png'])).toBeNull()
  })

  it('prüft das Paket beim Hochladen', () => {
    expect(pruefeHtml5Paket(tafelbild(), 'Herz.html5.zip')).toBe('k02_s046/index.html')
    const ohneSeite = Buffer.from(zipSync({ 'bild.png': strToU8('png') }))
    expect(() => pruefeHtml5Paket(ohneSeite, 'x.html5.zip')).toThrow(/Startseite/)
    expect(() => pruefeHtml5Paket(Buffer.from('kein zip'), 'x.html5.zip')).toThrow(/ZIP/)
  })

  it('Schlüssel gilt nur für ein Paket und läuft ab', () => {
    const jetzt = Date.UTC(2026, 9, 25, 8)
    const schluessel = html5Schluessel(ID, jetzt)
    expect(pruefeHtml5Schluessel(schluessel, jetzt)).toBe(ID)
    expect(pruefeHtml5Schluessel(schluessel, jetzt + 7 * 3600_000)).toBeNull()
    const [, ablauf, sig] = schluessel.split('.')
    expect(pruefeHtml5Schluessel(`${ID.replace('7', '8')}.${ablauf}.${sig}`, jetzt)).toBeNull()
    expect(pruefeHtml5Schluessel(`${ID}.${Number(ablauf) + 3600}.${sig}`, jetzt)).toBeNull()
    expect(pruefeHtml5Schluessel(undefined, jetzt)).toBeNull()
  })

  it('liefert passende Inhaltstypen', () => {
    expect(html5Inhaltstyp('a/index.HTML')).toMatch(/^text\/html/)
    expect(html5Inhaltstyp('js/main.js')).toMatch(/^text\/javascript/)
    expect(html5Inhaltstyp('img/cursors/hand.cur')).toBe('image/x-icon')
    expect(html5Inhaltstyp('unbekannt.xyz')).toBe('application/octet-stream')
  })

  it('Stapel entpackt HTML5-Pakete nicht – weder lose noch im Stapel-ZIP', () => {
    const lose = expandBulkArchives([{ buffer: tafelbild(), fileName: 'Herz.html5.zip', relativePath: 'Tafelbilder/Herz.html5.zip' }], {
      maxTotalBytes: 10 * 1024 * 1024,
    })
    expect(lose.archiveNames).toEqual([])
    expect(lose.files.map((f) => f.relativePath)).toEqual(['Tafelbilder/Herz.html5.zip'])

    const stapel = Buffer.from(zipSync({ 'Tafelbilder/Herz.html5.zip': new Uint8Array(tafelbild()), 'innen.zip': strToU8('x') }))
    const entpackt = expandBulkArchives([{ buffer: stapel, fileName: 'stapel.zip' }], { maxTotalBytes: 10 * 1024 * 1024 })
    expect(entpackt.files.map((f) => f.relativePath)).toEqual(['Tafelbilder/Herz.html5.zip'])
    expect(entpackt.skipped.map((s) => s.pfad)).toEqual(['innen.zip'])
  })
})

describe('HTML5-Bühne', () => {
  it('nimmt das Manifest, sonst die Viewport-Breite', () => {
    expect(html5BuehneAus('{"breite":1024,"hoehe":677}', null)).toEqual({ breite: 1024, hoehe: 677 })
    expect(html5BuehneAus('{"breite":"x"}', '<meta name="viewport" content="width=800" />')).toEqual({ breite: 800, hoehe: null })
    expect(html5BuehneAus(null, '<meta name="viewport" content="width=device-width, initial-scale=1">')).toBeNull()
    expect(html5BuehneAus('kaputt', null)).toBeNull()
  })
})
