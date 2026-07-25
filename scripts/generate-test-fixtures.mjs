/**
 * Erzeugt neutrale Test-Fixtures ohne reale Unterrichtsinhalte.
 * Aufruf: node scripts/generate-test-fixtures.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync, strToU8 } from 'fflate'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixturesDir = join(root, 'tests', 'fixtures')
mkdirSync(fixturesDir, { recursive: true })

async function buildSamplePdf() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page1 = doc.addPage([595, 842])
  const page2 = doc.addPage([595, 842])

  const lines = [
    'Arbeitsblatt: Photosynthese',
    'Die Pflanzen wandeln Licht in Energie um.',
    'Stichwort Zellteilung fuer die Suche.',
    'Umlautprobe: Gefuehle und Ueberblick.',
  ]

  let y = 780
  for (const line of lines) {
    page1.drawText(line, { x: 50, y, size: 14, font, color: rgb(0, 0, 0) })
    y -= 28
  }

  page2.drawText('Seite zwei mit weiterem Text zur Extraktion.', {
    x: 50,
    y: 780,
    size: 14,
    font,
    color: rgb(0, 0, 0),
  })

  return Buffer.from(await doc.save())
}

async function main() {
  const samplePdf = await buildSamplePdf()
  writeFileSync(join(fixturesDir, 'sample.pdf'), samplePdf)

  const attachmentPdf = await buildSamplePdf()
  const manifest = {
    Name: 'Biologie 09b',
    Schuljahr: '2024',
    Halbjahr: '2',
    Export: { Datum: '2025-07-01T12:00:00', User: 'Test Lehrkraft' },
    Termine: [
      {
        Tag: '2025-02-05',
        VonStunde: '1',
        BisStunde: '2',
        Stunden: '2',
        Thema: 'Einfuehrung',
        Inhalt: 'Grundlagen der Botanik',
        Hausaufgaben: 'Seite 12 lesen',
        Vertretungslehrkraft: null,
        Anhaenge: ['20250205_Einfuehrung/Arbeitsblatt.pdf'],
      },
      {
        Tag: '2025-02-12',
        VonStunde: '3',
        BisStunde: '4',
        Stunden: '2',
        Thema: 'Photosynthese',
        Inhalt: 'Ablauf der Photosynthese im Überblick',
        Hausaufgaben: 'Protokoll schreiben',
        Vertretungslehrkraft: null,
        Anhaenge: ['20250212_Photosynthese/Schema.pdf'],
      },
      {
        Tag: '2025-02-19',
        VonStunde: '1',
        BisStunde: '1',
        Stunden: '1',
        Thema: 'Abschluss',
        Inhalt: null,
        Hausaufgaben: null,
        Vertretungslehrkraft: null,
        Anhaenge: [],
      },
    ],
  }

  const zip = zipSync({
    'Biologie 09b.json': strToU8(JSON.stringify(manifest, null, 2)),
    'Hinweis.txt': strToU8('Export einer Kursmappe fuer SARU-Tests.'),
    '20250205_Einfuehrung/1 Thema.txt': strToU8('Einfuehrung'),
    '20250205_Einfuehrung/2 Inhalt.txt': strToU8('Grundlagen der Botanik'),
    '20250205_Einfuehrung/3 Hausaufgaben.txt': strToU8('Seite 12 lesen'),
    '20250205_Einfuehrung/Arbeitsblatt.pdf': new Uint8Array(attachmentPdf),
    '20250212_Photosynthese/1 Thema.txt': strToU8('Photosynthese'),
    '20250212_Photosynthese/2 Inhalt.txt': strToU8('Ablauf der Photosynthese im Überblick'),
    '20250212_Photosynthese/3 Hausaufgaben.txt': strToU8('Protokoll schreiben'),
    '20250212_Photosynthese/Schema.pdf': new Uint8Array(attachmentPdf),
  })

  writeFileSync(join(fixturesDir, 'schulportal-kursmappe.zip'), Buffer.from(zip))
  console.log('Fixtures geschrieben nach tests/fixtures/')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
