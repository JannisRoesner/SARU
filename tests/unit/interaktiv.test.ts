import { describe, expect, it } from 'vitest'
import {
  erklaerungFuerFrame,
  istInteraktivDatei,
  parseSwfKopf,
  parseSwfMetadaten,
} from '../../shared/utils/interaktiv'
import { guessMaterialType } from '../../shared/utils/material-type-guess'
import { isBulkMaterialFileName } from '../../shared/utils/ai-material-formats'

/** Baut eine minimale unkomprimierte SWF (550×400 px) mit beliebigen Tags. */
function baueSwf(tags: Uint8Array[]): Uint8Array {
  // RECT: 15 Bit pro Wert, xmin=0, xmax=11000, ymin=0, ymax=8000 (Twips)
  const nbits = 15
  const werte = [0, 11000, 0, 8000]
  let bits = nbits.toString(2).padStart(5, '0')
  for (const w of werte) bits += w.toString(2).padStart(nbits, '0')
  while (bits.length % 8) bits += '0'
  const rect = bits.match(/.{8}/g)!.map((b) => parseInt(b, 2))
  const rest = [...rect, 0x00, 0x0c, 24, 0, ...tags.flatMap((t) => [...t]), 0, 0]
  const laenge = 8 + rest.length
  return new Uint8Array([
    0x46, 0x57, 0x53, 8,
    laenge & 255, (laenge >> 8) & 255, 0, 0,
    ...rest,
  ])
}

function tag(code: number, inhalt: Uint8Array): Uint8Array {
  const lang = inhalt.length >= 0x3f
  const wert = (code << 6) | (lang ? 0x3f : inhalt.length)
  const kopf = [wert & 255, wert >> 8]
  if (lang) kopf.push(inhalt.length & 255, (inhalt.length >> 8) & 255, 0, 0)
  return new Uint8Array([...kopf, ...inhalt])
}

const json = {
  saru: 1,
  title: 'Zellmembran',
  stopFrames: [1, 10, 45],
  explanations: [
    { title: 'Start', text: 'Ausgangslage' },
    { title: 'Schritt 2', text: 'Lipide ordnen sich an' },
  ],
}

describe('interaktive Inhalte: Typ-Erkennung', () => {
  it('erkennt .swf an der Endung', () => {
    expect(istInteraktivDatei('bau.swf')).toBe(true)
    expect(istInteraktivDatei('ORDNER/Bau.SWF')).toBe(true)
    expect(istInteraktivDatei('bau.pdf')).toBe(false)
    expect(istInteraktivDatei(null)).toBe(false)
  })

  it('ordnet SWF-Dateien dem Materialtyp „interaktiv“ zu, auch bei Schlüsselwörtern im Namen', () => {
    expect(guessMaterialType('plasmolyse.swf')).toBe('interaktiv')
    expect(guessMaterialType('Synapse_Quiz_Lösung.swf')).toBe('interaktiv')
    expect(guessMaterialType('Kapitel/presentation.swf')).toBe('interaktiv')
    expect(guessMaterialType('AB_Zelle.pdf')).toBe('arbeitsblatt')
  })

  it('nimmt .swf in den Stapel-Upload auf', () => {
    expect(isBulkMaterialFileName('bau.swf')).toBe(true)
    expect(isBulkMaterialFileName('programm.exe')).toBe(false)
  })
})

describe('SWF-Metadaten', () => {
  it('liest Titel, Haltepunkte und Erklärtexte aus Tag 77', () => {
    const text = new TextEncoder().encode(JSON.stringify(json))
    const meta = parseSwfMetadaten(baueSwf([tag(9, new Uint8Array([1, 2, 3])), tag(77, text)]))
    expect(meta?.title).toBe('Zellmembran')
    expect(meta?.stopFrames).toEqual([1, 10, 45])
    expect(erklaerungFuerFrame(meta, 10)).toEqual({ title: 'Schritt 2', text: 'Lipide ordnen sich an' })
    // Zu Frame 45 gibt es keinen Erklärtext.
    expect(erklaerungFuerFrame(meta, 45)).toBeNull()
    expect(erklaerungFuerFrame(meta, 7)).toBeNull()
  })

  it('verarbeitet lange Tag-Köpfe und angehängte Nullbytes', () => {
    const text = new TextEncoder().encode(JSON.stringify(json) + ' '.repeat(80) + '\0')
    expect(parseSwfMetadaten(baueSwf([tag(77, text)]))?.stopFrames).toHaveLength(3)
  })

  it('liefert null ohne Tag, bei kaputtem JSON, fremdem JSON und komprimierten Dateien', () => {
    expect(parseSwfMetadaten(baueSwf([tag(9, new Uint8Array([1]))]))).toBeNull()
    expect(parseSwfMetadaten(baueSwf([tag(77, new TextEncoder().encode('{kaputt'))]))).toBeNull()
    expect(parseSwfMetadaten(baueSwf([tag(77, new TextEncoder().encode('{"a":1}'))]))).toBeNull()
    const komprimiert = baueSwf([])
    komprimiert[0] = 0x43
    expect(parseSwfMetadaten(komprimiert)).toBeNull()
    expect(parseSwfMetadaten(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('bricht bei abgeschnittenen Dateien nicht ab', () => {
    const swf = baueSwf([tag(77, new TextEncoder().encode(JSON.stringify(json)))])
    expect(parseSwfMetadaten(swf.subarray(0, swf.length - 30))).toBeNull()
  })

  it('liest die Bühnengröße aus dem Header', () => {
    const kopf = parseSwfKopf(baueSwf([]))
    expect(kopf).toMatchObject({ version: 8, breite: 550, hoehe: 400, bilder: 24 })
  })
})
