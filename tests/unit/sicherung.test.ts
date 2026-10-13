import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { unzipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  auswahlUmfang,
  auswahlZusammenfassen,
  eintragHatNeues,
  freierName,
  pfadSegment,
  type SicherungAnalyse,
} from '../../shared/utils/sicherung'
import { dateiPfade, materialOrdner } from '../../server/services/sicherung/pfade'
import { crc32, ZipLeser, zipSchreiben } from '../../server/services/sicherung/zip'

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'saru-sicherung-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function zipAufPlatte(name: string, quellen: Parameters<typeof zipSchreiben>[0]): Promise<string> {
  const ziel = join(dir, name)
  await pipeline(zipSchreiben(quellen), createWriteStream(ziel))
  return ziel
}

describe('ZIP-Schreiber und -Leser', () => {
  it('berechnet CRC-32 wie der Standard', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    expect(crc32(Buffer.from('6789'), crc32(Buffer.from('12345')))).toBe(0xcbf43926)
  })

  it('schreibt Puffer und Dateien, die sich wieder lesen lassen', async () => {
    const quelle = join(dir, 'gross.bin')
    const inhalt = Buffer.alloc(300_000)
    for (let i = 0; i < inhalt.length; i += 1) inhalt[i] = (i * 31) % 251
    await writeFile(quelle, inhalt)

    const json = Buffer.from(JSON.stringify({ hallo: 'Welt', liste: Array.from({ length: 500 }, (_, i) => i) }))
    const pfad = await zipAufPlatte('runde.zip', [
      { name: 'saru-export.json', daten: json },
      { name: 'Lehrwerke/Natura 9 – Ökologie/Seite 12.pdf', datei: quelle, groesse: inhalt.length },
      { name: 'leer.txt', daten: Buffer.alloc(0) },
    ])

    const leser = await ZipLeser.oeffnen(pfad)
    expect([...leser.eintraege.keys()]).toEqual([
      'saru-export.json',
      'Lehrwerke/Natura 9 – Ökologie/Seite 12.pdf',
      'leer.txt',
    ])
    expect(await leser.puffer(leser.eintraege.get('saru-export.json')!, 1e6)).toEqual(json)
    expect(await leser.puffer(leser.eintraege.get('Lehrwerke/Natura 9 – Ökologie/Seite 12.pdf')!, 1e6)).toEqual(inhalt)
    expect((await leser.puffer(leser.eintraege.get('leer.txt')!, 10)).length).toBe(0)

    // Gegenprobe mit einer unabhängigen Implementierung.
    const fremd = unzipSync(new Uint8Array(await readFile(pfad)))
    expect(Buffer.from(fremd['Lehrwerke/Natura 9 – Ökologie/Seite 12.pdf']!)).toEqual(inhalt)
    expect(Buffer.from(fremd['saru-export.json']!)).toEqual(json)
  })

  it('schreibt bei sehr vielen Einträgen ein ZIP64-Verzeichnis', async () => {
    const anzahl = 70_000
    function* viele() {
      for (let i = 0; i < anzahl; i += 1) yield { name: `d/${i}.txt`, daten: Buffer.from(String(i)) }
    }
    const pfad = await zipAufPlatte('viele.zip', viele())
    const leser = await ZipLeser.oeffnen(pfad)
    expect(leser.eintraege.size).toBe(anzahl)
    expect((await leser.puffer(leser.eintraege.get('d/69999.txt')!, 100)).toString()).toBe('69999')
  }, 60_000)

  it('erkennt beschädigte Inhalte über die Prüfsumme', async () => {
    const quelle = join(dir, 'kaputt.bin')
    const inhalt = Buffer.from('Inhalt, der gleich verändert wird')
    await writeFile(quelle, inhalt)
    const pfad = await zipAufPlatte('kaputt.zip', [{ name: 'a.bin', datei: quelle, groesse: inhalt.length }])
    const roh = await readFile(pfad)
    const stelle = roh.indexOf(Buffer.from('Inhalt'))
    roh[stelle] = 'X'.charCodeAt(0)
    await writeFile(pfad, roh)

    const leser = await ZipLeser.oeffnen(pfad)
    await expect(leser.puffer(leser.eintraege.get('a.bin')!, 100)).rejects.toThrow(/Prüfsumme/)
  })

  it('lehnt Dateien ohne ZIP-Verzeichnis ab', async () => {
    const pfad = join(dir, 'kein.zip')
    await writeFile(pfad, Buffer.from('das ist kein Archiv, nur Text mit etwas Länge'))
    await expect(ZipLeser.oeffnen(pfad)).rejects.toThrow(/kein gültiges Archiv/)
  })

  it('bricht ab, wenn sich eine Datei während der Sicherung ändert', async () => {
    const quelle = join(dir, 'klein.bin')
    await writeFile(quelle, Buffer.from('abc'))
    await expect(zipAufPlatte('falsch.zip', [{ name: 'x', datei: quelle, groesse: 10 }])).rejects.toThrow(/verändert/)
  })
})

describe('Ordnerstruktur der Sicherung', () => {
  it('bereinigt Namen für alle Dateisysteme', () => {
    expect(pfadSegment('Kap. 3: Zelle/Gewebe?')).toBe('Kap. 3 Zelle Gewebe')
    expect(pfadSegment('  ...  ')).toBe('Ohne Titel')
    expect(pfadSegment('Ende mit Punkt.')).toBe('Ende mit Punkt')
    const belegt = new Set<string>()
    expect(freierName('Blatt', belegt, '.pdf')).toBe('Blatt.pdf')
    expect(freierName('blatt', belegt, '.pdf')).toBe('blatt (2).pdf')
  })

  it('ordnet Lehrwerke, Kinder, Lösungen und lose Materialien ein', () => {
    const ordner = materialOrdner(
      [
        { id: 'k1', title: 'Kopiervorlage Fotosynthese', materialType: 'arbeitsblatt' },
        { id: 'lw', title: 'Natura 9', materialType: 'lehrwerk' },
        { id: 'l1', title: 'Lösung Fotosynthese', materialType: 'musterloesung' },
        { id: 'a1', title: 'Zellatmung', materialType: 'arbeitsblatt' },
        { id: 'a2', title: 'Zellatmung', materialType: 'arbeitsblatt' },
        { id: 'n1', title: 'Notiz', materialType: 'notiz' },
      ],
      [
        { fromMaterialId: 'k1', toMaterialId: 'lw', relationType: 'gehoert_zu' },
        { fromMaterialId: 'k1', toMaterialId: 'l1', relationType: 'musterloesung' },
      ],
      new Map([
        ['a1', 'Biologie'],
        ['a2', 'Biologie'],
      ]),
    )
    expect(ordner.get('lw')).toBe('Lehrwerke/Natura 9')
    expect(ordner.get('k1')).toBe('Lehrwerke/Natura 9/Kopiervorlage Fotosynthese')
    expect(ordner.get('l1')).toBe('Lehrwerke/Natura 9/Kopiervorlage Fotosynthese/Lösung Fotosynthese')
    expect(ordner.get('a1')).toBe('Materialien/Biologie/Zellatmung')
    expect(ordner.get('a2')).toBe('Materialien/Biologie/Zellatmung (2)')
    expect(ordner.get('n1')).toBe('Materialien/Ohne Fach/Notiz')
  })

  it('übersteht zyklische Zuordnungen', () => {
    const ordner = materialOrdner(
      [
        { id: 'a', title: 'A', materialType: 'arbeitsblatt' },
        { id: 'b', title: 'B', materialType: 'arbeitsblatt' },
      ],
      [
        { fromMaterialId: 'a', toMaterialId: 'b', relationType: 'gehoert_zu' },
        { fromMaterialId: 'b', toMaterialId: 'a', relationType: 'gehoert_zu' },
      ],
      new Map(),
    )
    expect(ordner.size).toBe(2)
  })

  it('legt weitere Varianten in Unterordner und macht Dateinamen eindeutig', () => {
    const pfade = dateiPfade(
      new Map([['m', 'Materialien/Bio/Blatt']]),
      [
        { id: 'v2', materialId: 'm', label: 'Förderfassung', isDefault: false, sortOrder: 1 },
        { id: 'v1', materialId: 'm', label: 'Standard', isDefault: true, sortOrder: 0 },
      ],
      [
        { id: 'x1', variantId: 'v1', fileName: 'blatt.pdf' },
        { id: 'x2', variantId: 'v1', fileName: 'Blatt.PDF' },
        { id: 'x3', variantId: 'v2', fileName: 'blatt.pdf' },
        { id: 'x4', variantId: 'v1', fileName: null },
      ],
    )
    expect(pfade.get('x1')).toBe('Materialien/Bio/Blatt/blatt.pdf')
    expect(pfade.get('x2')).toBe('Materialien/Bio/Blatt/Blatt (2).pdf')
    expect(pfade.get('x3')).toBe('Materialien/Bio/Blatt/Variante – Förderfassung/blatt.pdf')
    expect(pfade.get('x4')).toBe('Materialien/Bio/Blatt/Datei')
  })
})

describe('Auswahl beim Einspielen', () => {
  const analyse: Pick<SicherungAnalyse, 'eintraege' | 'materialien' | 'stunden' | 'reihen'> = {
    eintraege: [
      { id: 'lw', art: 'lehrwerk', titel: 'Natura', untertitel: null, materialIds: ['lw', 'k1'], stundenIds: [], reihenIds: [] },
      { id: 'r', art: 'reihe', titel: 'Ökologie', untertitel: null, materialIds: ['k1', 'a1'], stundenIds: ['s1'], reihenIds: ['r'] },
      { id: 'a2', art: 'material', titel: 'Alt', untertitel: null, materialIds: ['a2'], stundenIds: [], reihenIds: [] },
    ],
    materialien: {
      lw: { titel: 'Natura', typ: 'lehrwerk', dateien: 1, bytes: 1000, dublette: { art: 'gleiche_id', zielId: 'lw', titel: 'Natura' } },
      k1: { titel: 'KV', typ: 'arbeitsblatt', dateien: 2, bytes: 200, dublette: null },
      a1: { titel: 'AB', typ: 'arbeitsblatt', dateien: 1, bytes: 50, dublette: { art: 'gleicher_inhalt', zielId: 'x', titel: 'AB' } },
      a2: { titel: 'Alt', typ: 'arbeitsblatt', dateien: 1, bytes: 10, dublette: { art: 'gleiche_id', zielId: 'a2', titel: 'Alt' } },
    },
    stunden: { s1: { titel: 'Stunde', dublette: null } },
    reihen: { r: { titel: 'Ökologie', dublette: null } },
  }

  it('vereinigt Abhängigkeiten ohne Doppelzählung', () => {
    const umfang = auswahlUmfang(analyse, ['lw', 'r'])
    expect([...umfang.materialIds].sort()).toEqual(['a1', 'k1', 'lw'])
    expect([...umfang.stundenIds]).toEqual(['s1'])
  })

  it('zählt Dubletten als vorhanden, außer inhaltsgleiche sollen neu angelegt werden', () => {
    expect(auswahlZusammenfassen(analyse, { eintraege: ['lw', 'r'], inhaltsgleicheAnlegen: false })).toEqual({
      materialien: 1,
      stunden: 1,
      reihen: 1,
      dateien: 2,
      bytes: 200,
      vorhanden: 2,
    })
    expect(auswahlZusammenfassen(analyse, { eintraege: ['lw', 'r'], inhaltsgleicheAnlegen: true })).toMatchObject({
      materialien: 2,
      vorhanden: 1,
    })
  })

  it('wählt standardmäßig nur Einträge mit Neuem', () => {
    expect(eintragHatNeues(analyse, analyse.eintraege[0]!)).toBe(true)
    expect(eintragHatNeues(analyse, analyse.eintraege[2]!)).toBe(false)
    expect(eintragHatNeues(analyse, analyse.eintraege[2]!, true)).toBe(false)
  })
})
