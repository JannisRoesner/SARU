import { describe, expect, it } from 'vitest'
import {
  erklaerungFuerFrame,
  istInteraktivDatei,
  parseSwfKopf,
  paketBereiche,
  paketPfad,
  paketVerzeichnis,
  parseSwfMetadaten,
} from '../../shared/utils/interaktiv'
import { interaktivRahmenDokument, PAKET_HERKUNFT } from '../../app/utils/interaktiv-rahmen'
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

function metaAus(daten: unknown) {
  return parseSwfMetadaten(baueSwf([tag(77, new TextEncoder().encode(JSON.stringify(daten)))]))
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

  it('ordnet Erklärtexte auch bei ungültigen Frames dem richtigen Haltepunkt zu', () => {
    const text = new TextEncoder().encode(
      JSON.stringify({
        saru: 1,
        stopFrames: [0, 10, 45],
        explanations: [{ title: 'ungültig', text: '' }, { title: 'A', text: '' }, { title: 'B', text: '' }],
      }),
    )
    const meta = parseSwfMetadaten(baueSwf([tag(77, text)]))
    expect(meta?.stopFrames).toEqual([10, 45])
    expect(erklaerungFuerFrame(meta, 10)?.title).toBe('A')
    expect(erklaerungFuerFrame(meta, 45)?.title).toBe('B')
  })

  it('bricht bei abgeschnittenen Dateien nicht ab', () => {
    const swf = baueSwf([tag(77, new TextEncoder().encode(JSON.stringify(json)))])
    expect(parseSwfMetadaten(swf.subarray(0, swf.length - 30))).toBeNull()
  })

  it('setzt die neuen Felder bei älteren SWFs auf neutrale Werte', () => {
    const meta = parseSwfMetadaten(baueSwf([tag(77, new TextEncoder().encode(JSON.stringify(json)))]))
    expect(meta).toMatchObject({ aktionen: [], schieber: false, totalFrames: null })
  })

  it('liest Zusatzknöpfe, Umschalter und den Zeitleisten-Schieber', () => {
    const meta = metaAus({
      saru: 1,
      stopFrames: [],
      aktionen: [
        { label: 'Manuell', fn: 'setAutomode', arg: false, labelAus: 'Automatisch', argAus: true },
        { label: ' Zurücksetzen ', fn: 'reset' },
        { label: 'Schritt', fn: 'gehe', arg: 3, labelAus: 'Zurück' },
      ],
      schieber: true,
      totalFrames: 240,
    })
    expect(meta?.aktionen).toEqual([
      { label: 'Manuell', fn: 'setAutomode', arg: false, umschalten: { label: 'Automatisch', arg: true } },
      { label: 'Zurücksetzen', fn: 'reset', arg: undefined, umschalten: null },
      { label: 'Schritt', fn: 'gehe', arg: 3, umschalten: { label: 'Zurück', arg: undefined } },
    ])
    expect(meta?.schieber).toBe(true)
    expect(meta?.totalFrames).toBe(240)
  })

  it('verwirft ungültige Zusatzknöpfe und Schieber-Angaben', () => {
    const meta = metaAus({
      saru: 1,
      aktionen: [
        null,
        'Manuell',
        { label: '', fn: 'a' },
        { label: 'Ohne Funktion' },
        { label: 'Code', fn: 'a(); b' },
        { label: 'Pfad', fn: '_root.x' },
        { label: 'Objekt', fn: 'f', arg: { x: 1 }, labelAus: '  ', argAus: true },
        { label: 'Unendlich', fn: 'g', arg: Number.POSITIVE_INFINITY },
      ],
      schieber: 'ja',
      totalFrames: 12.5,
    })
    expect(meta?.aktionen).toEqual([
      { label: 'Objekt', fn: 'f', arg: undefined, umschalten: null },
      // JSON macht aus Infinity null – das ist ein gültiges Argument.
      { label: 'Unendlich', fn: 'g', arg: null, umschalten: null },
    ])
    expect(meta?.schieber).toBe(false)
    expect(meta?.totalFrames).toBeNull()
    expect(metaAus({ saru: 1, aktionen: 'x', totalFrames: 0 })).toMatchObject({ aktionen: [], totalFrames: null })
  })

  it('begrenzt die Zahl der Zusatzknöpfe', () => {
    const aktionen = Array.from({ length: 12 }, (_, i) => ({ label: `K${i}`, fn: `f${i}` }))
    expect(metaAus({ saru: 1, aktionen })?.aktionen).toHaveLength(8)
  })

  it('liest die Bühnengröße aus dem Header', () => {
    const kopf = parseSwfKopf(baueSwf([]))
    expect(kopf).toMatchObject({ version: 8, breite: 550, hoehe: 400, bilder: 24 })
  })
})

function binaer(id: number, inhalt: string): Uint8Array {
  const daten = new TextEncoder().encode(inhalt)
  return tag(87, new Uint8Array([id & 255, id >> 8, 0, 0, 0, 0, ...daten]))
}

describe('interaktive Inhalte: Paket-SWF', () => {
  const manifest = {
    saru: 1,
    title: 'Mitose',
    paket: {
      version: 1,
      start: 'module/flinter/Flinter.swf',
      basis: 'html/mels/',
      parameter: { MedienElementID: 'mel_807552', zahl: 3, objekt: { a: 1 } },
      dateien: [
        { pfad: 'module/flinter/Flinter.swf', id: 1, typ: 'application/x-shockwave-flash' },
        { pfad: 'medien\\rsc\\mel_1\\content.xml', id: 2, typ: 'text/xml' },
        { pfad: '../fehlt.txt', id: 3, typ: 'kein typ' },
        { pfad: 'kaputt', id: 'x' },
      ],
    },
  }
  const swf = baueSwf([
    tag(77, new TextEncoder().encode(JSON.stringify(manifest))),
    binaer(1, 'FWS-Start'),
    binaer(2, '<Pool/>'),
  ])

  it('liest das Manifest mit normalisierten Pfaden und FlashVars', () => {
    const paket = parseSwfMetadaten(swf)?.paket
    expect(paket).toMatchObject({
      start: 'module/flinter/flinter.swf',
      basis: 'html/mels/',
      parameter: { MedienElementID: 'mel_807552', zahl: '3' },
    })
    expect(paket?.dateien.map((d) => d.pfad)).toEqual([
      'module/flinter/flinter.swf',
      'medien/rsc/mel_1/content.xml',
      'fehlt.txt',
    ])
    expect(paket?.dateien[2]?.typ).toBe('application/octet-stream')
  })

  it('findet die Nutzdaten der DefineBinaryData-Tags', () => {
    const paket = parseSwfMetadaten(swf)!.paket!
    const verzeichnis = paketVerzeichnis(swf, paket)
    const text = (pfad: string) => {
      const e = verzeichnis[pfad]!
      return new TextDecoder().decode(swf.subarray(e.o, e.o + e.l))
    }
    expect(text('module/flinter/flinter.swf')).toBe('FWS-Start')
    expect(text('medien/rsc/mel_1/content.xml')).toBe('<Pool/>')
    expect(verzeichnis['medien/rsc/mel_1/content.xml']?.t).toBe('text/xml')
    // Eintrag ohne Daten-Tag entfällt.
    expect(verzeichnis['fehlt.txt']).toBeUndefined()
    expect(paketBereiche(swf).size).toBe(2)
  })

  it('verwirft Manifeste ohne Start-Datei und lässt gewöhnliche SWFs ohne Paket', () => {
    expect(metaAus({ saru: 1, paket: { start: 'a.swf', dateien: [{ pfad: 'b.swf', id: 1 }] } })?.paket).toBeNull()
    expect(metaAus({ saru: 1, paket: 'x' })?.paket).toBeNull()
    expect(metaAus(json)?.paket).toBeNull()
  })

  it('nimmt ohne Basis den Ordner der Start-SWF', () => {
    const meta = metaAus({
      saru: 1,
      paket: { start: 'German/Module1/Module1.swf', dateien: [{ pfad: 'german/module1/module1.swf', id: 1 }] },
    })
    expect(meta?.paket?.basis).toBe('german/module1/')
  })

  it('normalisiert Pfade wie relative URLs', () => {
    expect(paketPfad('German/Module1/../../Common/Module1/images/1_A2.JPG?x=1#a')).toBe('common/module1/images/1_a2.jpg')
    expect(paketPfad('./a//b\\C%20d.txt')).toBe('a/b/c d.txt')
    expect(paketPfad('../../x.swf')).toBe('x.swf')
    expect(paketPfad('%E0%A4%A')).toBe('%e0%a4%a')
  })
})

describe('interaktive Inhalte: Player-iframe', () => {
  it('bedient Paketabrufe aus dem Paket und erlaubt keine Seitenwechsel', () => {
    const doc = interaktivRahmenDokument('https://saru.example')
    expect(doc).toContain(JSON.stringify(PAKET_HERKUNFT))
    expect(doc).toContain('openUrlMode: \'deny\'')
    expect(doc).toContain('"https://saru.example/ruffle/"')
  })

  it('normalisiert Pfade im iframe wie paketPfad()', () => {
    const doc = interaktivRahmenDokument('https://saru.example')
    const quelle = /function paketPfad\(roh\) \{[\s\S]*?\n {4}\}/.exec(doc)![0]
    const iframePfad = new Function(`${quelle}; return paketPfad`)() as (roh: string) => string
    for (const roh of ['German/Module1/../../Common/X.JPG?x', 'a\\b\\..\\c.txt', './A%20B.swf', '../../x']) {
      expect(iframePfad(roh)).toBe(paketPfad(roh))
    }
  })
})
