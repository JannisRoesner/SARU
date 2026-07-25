import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import {
  alignAnswersToBlanks,
  buildSolutionDocx,
  detectPdfBlankRegions,
  fillDocxDocument,
  fillPdfAcroForm,
  formatBlankInventory,
  inferAnswerFieldType,
  overlayPdfAnswers,
  parseStructuredSolution,
  sanitizePdfText,
  solutionToMarkdown,
  topLeftNormToPdfBaseline,
  type PdfBlankRegion,
} from '../../server/services/ai/document-fill'

function minimalDocxWithBody(bodyXml: string): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}</w:body>
</w:document>`

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

  return Buffer.from(
    zipSync(
      {
        '[Content_Types].xml': strToU8(contentTypes),
        '_rels/.rels': strToU8(rels),
        'word/document.xml': strToU8(documentXml),
      },
      { level: 6 },
    ),
  )
}

async function worksheetPdf(pageCount = 2): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pageCount; i++) {
    const page = pdf.addPage([595.28, 841.89])
    page.drawText(`Arbeitsblatt Seite ${i + 1}`, {
      x: 50,
      y: 780,
      size: 14,
      font,
      color: rgb(0, 0, 0),
    })
    page.drawText('1. Die _____________ ist der Prozess der Photosynthese.', {
      x: 50,
      y: 700,
      size: 11,
      font,
    })
    page.drawRectangle({
      x: 40,
      y: 40,
      width: 515,
      height: 760,
      borderColor: rgb(0.7, 0.7, 0.7),
      borderWidth: 1,
    })
  }
  return Buffer.from(await pdf.save())
}

describe('parseStructuredSolution', () => {
  it('liest reines JSON', () => {
    const result = parseStructuredSolution(
      JSON.stringify({
        summary: 'Kurzüberblick',
        answers: [{ id: '1', label: 'Aufgabe 1', answer: 'Photosynthese', blankIndex: 0 }],
        formFields: [{ name: 'Text1', value: 'Antwort' }],
      }),
    )
    expect(result.summary).toBe('Kurzüberblick')
    expect(result.answers).toHaveLength(1)
    expect(result.answers[0]!.answer).toBe('Photosynthese')
    expect(result.formFields[0]!.name).toBe('Text1')
  })

  it('parst bbox-Koordinaten (inkl. Prozentwerte)', () => {
    const result = parseStructuredSolution(
      JSON.stringify({
        summary: 'S',
        answers: [
          {
            label: '1a',
            answer: 'Zellkern',
            page: 1,
            blankIndex: 0,
            leftContext: 'Die',
            rightContext: 'des Penis',
            bbox: { x: 0.4, y: 0.25, w: 0.3, h: 0.03 },
          },
          {
            label: '1b',
            answer: 'Mitochondrium',
            page: 2,
            x: 45,
            y: 30,
            w: 35,
            h: 3,
          },
        ],
        formFields: [],
      }),
    )
    expect(result.answers[0]!.bbox).toEqual({ x: 0.4, y: 0.25, w: 0.3, h: 0.03 })
    expect(result.answers[0]!.leftContext).toBe('Die')
    expect(result.answers[0]!.rightContext).toBe('des Penis')
    expect(result.answers[1]!.bbox?.x).toBeCloseTo(0.45)
    expect(result.answers[1]!.bbox?.y).toBeCloseTo(0.3)
  })

  it('akzeptiert JSON in Markdown-Fence', () => {
    const result = parseStructuredSolution(`Hier die Lösung:
\`\`\`json
{"summary":"S","answers":[{"label":"A1","answer":"42"}],"formFields":[]}
\`\`\``)
    expect(result.answers[0]!.answer).toBe('42')
  })

  it('fällt bei Freitext auf eine Antwort zurück', () => {
    const result = parseStructuredSolution('Einfach nur Fließtext als Lösung.')
    expect(result.answers).toHaveLength(1)
    expect(result.answers[0]!.answer).toContain('Fließtext')
  })

  it('liest fieldType', () => {
    const result = parseStructuredSolution(
      JSON.stringify({
        summary: 'S',
        answers: [
          { label: 'A', answer: 'kurz', fieldType: 'luecke' },
          { label: 'B', answer: 'langer Text', type: 'freitext' },
        ],
        formFields: [],
      }),
    )
    expect(result.answers[0]!.fieldType).toBe('luecke')
    expect(result.answers[1]!.fieldType).toBe('freitext')
  })
})

describe('inferAnswerFieldType', () => {
  it('erkennt Freitext anhand bbox-Höhe und Textlänge', () => {
    expect(
      inferAnswerFieldType({
        id: '1',
        label: 'A',
        answer: 'x',
        bbox: { x: 0.1, y: 0.1, w: 0.4, h: 0.08 },
      }),
    ).toBe('freitext')
    expect(
      inferAnswerFieldType({
        id: '2',
        label: 'B',
        answer: 'kurz',
        bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.02 },
      }),
    ).toBe('luecke')
  })
})

describe('sanitizePdfText', () => {
  it('bewahrt Umlaute und ersetzt typografische Zeichen', () => {
    expect(sanitizePdfText('Größe – „Äpfel“ …')).toContain('Größe')
    expect(sanitizePdfText('Größe – „Äpfel“ …')).toContain('Äpfel')
    expect(sanitizePdfText('Größe – „Äpfel“ …')).not.toContain('„')
  })
})

describe('solutionToMarkdown', () => {
  it('formatiert Antworten mit optionaler Seite', () => {
    const md = solutionToMarkdown({
      summary: 'Überblick',
      answers: [{ id: '1', label: 'Aufgabe 1', answer: 'Lösung A', page: 2 }],
      formFields: [],
    })
    expect(md).toContain('### Aufgabe 1 (S. 2)')
    expect(md).toContain('Lösung A')
  })
})

describe('fillDocxDocument', () => {
  it('ersetzt Unterstrich-Lücken in der Reihenfolge', () => {
    const blanked = minimalDocxWithBody(`
      <w:p><w:r><w:t>Frage 1: ______</w:t></w:r></w:p>
      <w:p><w:r><w:t>Frage 2: ______</w:t></w:r></w:p>
    `)

    const filled = fillDocxDocument(blanked, {
      summary: 'Test',
      answers: [
        { id: '1', label: '1', answer: 'Zellkern' },
        { id: '2', label: '2', answer: 'Mitochondrium' },
      ],
      formFields: [],
    })

    expect(filled.strategy).toBe('docx_inplace')
    const xml = strFromU8(unzipSync(new Uint8Array(filled.buffer))['word/document.xml']!)
    expect(xml).toContain('Zellkern')
    expect(xml).toContain('Mitochondrium')
    expect(xml).not.toContain('______')
  })

  it('hängt einen Lösungsabschnitt an, wenn keine Lücken vorhanden sind', () => {
    const source = buildSolutionDocx('Arbeitsblatt ohne Lücken', {
      summary: 'Original',
      answers: [{ id: '1', label: 'Hinweis', answer: 'nur Text' }],
      formFields: [],
    })
    const filled = fillDocxDocument(source, {
      summary: 'Lösung',
      answers: [{ id: '1', label: 'Aufgabe 1', answer: 'Korrekte Antwort' }],
      formFields: [],
    })
    expect(filled.strategy).toBe('docx_appended')
    const xml = strFromU8(unzipSync(new Uint8Array(filled.buffer))['word/document.xml']!)
    expect(xml).toContain('Musterlösung (KI)')
    expect(xml).toContain('Korrekte Antwort')
  })
})

describe('fillPdfAcroForm', () => {
  it('füllt vorhandene Textfelder', async () => {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([300, 200])
    const form = pdf.getForm()
    const field = form.createTextField('Antwort1')
    field.addToPage(page, { x: 50, y: 100, width: 200, height: 20 })
    const source = Buffer.from(await pdf.save())

    const result = await fillPdfAcroForm(source, {
      summary: 'Test',
      answers: [{ id: '1', label: '1', answer: 'Fotosynthese' }],
      formFields: [{ name: 'Antwort1', value: 'Fotosynthese' }],
    })

    expect(result).not.toBeNull()
    expect(result!.filled).toBe(1)
    expect(result!.buffer.length).toBeGreaterThan(100)

    const loaded = await PDFDocument.load(result!.buffer)
    expect(loaded.getPageCount()).toBe(1)
  })

  it('liefert null ohne Formularfelder', async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage([200, 200])
    const source = Buffer.from(await pdf.save())
    const result = await fillPdfAcroForm(source, {
      summary: 'Test',
      answers: [{ id: '1', label: '1', answer: 'X' }],
      formFields: [],
    })
    expect(result).toBeNull()
  })
})

describe('topLeftNormToPdfBaseline', () => {
  it('spiegelt Y vom Bild-Ursprung (oben links) in PDF-User-Space (unten links)', () => {
    const pageHeight = 841.89
    const fontSize = 12
    // yNorm=0 → oben auf der Seite → hohe PDF-Y
    const top = topLeftNormToPdfBaseline(0, pageHeight, fontSize)
    const bottom = topLeftNormToPdfBaseline(1, pageHeight, fontSize)
    expect(top).toBeGreaterThan(pageHeight - fontSize - 8)
    expect(bottom).toBeLessThan(fontSize + 8)
    // yNorm=0.25 → Baseline deutlich im oberen Viertel
    const quarter = topLeftNormToPdfBaseline(0.25, pageHeight, fontSize, pageHeight * 0.03)
    expect(quarter).toBeGreaterThan(pageHeight * 0.7)
    expect(quarter).toBeLessThan(pageHeight * 0.8)
  })
})

describe('detectPdfBlankRegions', () => {
  it('findet Unterstrich-Lücken in getippten Arbeitsblättern', async () => {
    const source = await worksheetPdf(1)
    const blanks = await detectPdfBlankRegions(source)
    expect(blanks.length).toBeGreaterThanOrEqual(1)
    expect(blanks[0]!.kind).toBe('underscore')
    expect(blanks[0]!.pageIndex).toBe(0)
    // Lücke liegt in der Zeile mit „Die _____________ ist …“ (y ≈ 700)
    expect(blanks[0]!.y).toBeGreaterThan(680)
    expect(blanks[0]!.y).toBeLessThan(720)
    expect(blanks[0]!.width).toBeGreaterThan(40)
    expect(blanks[0]!.leftText.toLowerCase()).toContain('die')
    expect(blanks[0]!.rightText.toLowerCase()).toContain('ist')
  })

  it('findet Textlücken (Gaps) zwischen Wörtern derselben Zeile', async () => {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const page = pdf.addPage([595.28, 841.89])
    page.drawText('Die', { x: 50, y: 500, size: 14, font })
    // Große Lücke, dann Fortsetzung – typischer Lückentext ohne Unterstriche.
    page.drawText('des Penis ist bedeckt.', { x: 180, y: 500, size: 14, font })
    page.drawText('ist sie sehr', { x: 50, y: 470, size: 14, font })
    page.drawText('und steht vorne.', { x: 200, y: 470, size: 14, font })
    const source = Buffer.from(await pdf.save())

    const blanks = await detectPdfBlankRegions(source)
    expect(blanks.length).toBeGreaterThanOrEqual(2)
    expect(blanks.every((b) => b.kind === 'gap')).toBe(true)
    expect(blanks[0]!.x).toBeGreaterThan(50)
    expect(blanks[0]!.x).toBeLessThan(180)
    expect(blanks[0]!.width).toBeGreaterThan(50)
    expect(blanks[0]!.leftText).toContain('Die')
    expect(blanks[0]!.rightText).toContain('des Penis')
  })
})

describe('alignAnswersToBlanks', () => {
  const blanks: PdfBlankRegion[] = [
    {
      pageIndex: 0,
      blankIndex: 0,
      x: 70,
      y: 460,
      width: 100,
      height: 14,
      kind: 'gap',
      leftText: 'Die',
      rightText: 'des Penis ist',
    },
    {
      pageIndex: 0,
      blankIndex: 1,
      x: 50,
      y: 420,
      width: 110,
      height: 14,
      kind: 'gap',
      leftText: 'allen Jungen',
      rightText: '. Bei einigen',
    },
    {
      pageIndex: 0,
      blankIndex: 2,
      x: 120,
      y: 400,
      width: 70,
      height: 14,
      kind: 'gap',
      leftText: 'ist sie sehr',
      rightText: 'und steht vorne',
    },
  ]

  it('ordnet vertauschte blankIndex-Werte über Kontext neu zu', () => {
    const aligned = alignAnswersToBlanks(
      {
        summary: 'S',
        answers: [
          {
            id: '1',
            label: '1',
            answer: 'lang',
            blankIndex: 0,
            leftContext: 'ist sie sehr',
            rightContext: 'und steht',
          },
          {
            id: '2',
            label: '2',
            answer: 'Eichel',
            blankIndex: 2,
            leftContext: 'Die',
            rightContext: 'des Penis',
          },
          {
            id: '3',
            label: '3',
            answer: 'unterschiedlich',
            blankIndex: 1,
            leftContext: 'Jungen',
            rightContext: '. Bei einigen',
          },
        ],
        formFields: [],
      },
      blanks,
    )

    expect(aligned.answers.find((a) => a.answer === 'Eichel')?.blankIndex).toBe(0)
    expect(aligned.answers.find((a) => a.answer === 'unterschiedlich')?.blankIndex).toBe(1)
    expect(aligned.answers.find((a) => a.answer === 'lang')?.blankIndex).toBe(2)
  })

  it('formatiert eine lesbare Lückenliste für den Prompt', () => {
    const text = formatBlankInventory(blanks)
    expect(text).toContain('0:')
    expect(text).toContain('Die')
    expect(text).toContain('des Penis')
    expect(text).toContain('___')
  })
})

describe('overlayPdfAnswers', () => {
  it('bewahrt Seitenzahl und zeichnet Overlays mit bbox', async () => {
    // Seite ohne erkennbare Lücken-Geometrie → bbox-Pfad.
    const pdf = await PDFDocument.create()
    for (let i = 0; i < 3; i++) {
      const page = pdf.addPage([595.28, 841.89])
      const font = await pdf.embedFont(StandardFonts.Helvetica)
      page.drawText(`Seite ${i + 1}`, { x: 50, y: 780, size: 14, font })
    }
    const source = Buffer.from(await pdf.save())

    const result = await overlayPdfAnswers(source, {
      summary: 'Test-Overlay',
      answers: [
        {
          id: '1',
          label: '1',
          answer: 'Photosynthese',
          page: 1,
          blankIndex: 0,
          bbox: { x: 0.25, y: 0.18, w: 0.4, h: 0.03 },
        },
        {
          id: '2',
          label: '2',
          answer: 'Chloroplast',
          page: 2,
          blankIndex: 1,
          bbox: { x: 0.3, y: 0.4, w: 0.35, h: 0.025 },
        },
        {
          id: '3',
          label: '3',
          answer: 'Größe',
          page: 3,
          blankIndex: 2,
          bbox: { x: 0.2, y: 0.55, w: 0.5, h: 0.03 },
        },
      ],
      formFields: [],
    })

    expect(result.overlays).toBe(3)
    expect(result.usedBBox).toBe(3)
    expect(result.usedGeometry).toBe(0)

    const loaded = await PDFDocument.load(result.buffer)
    expect(loaded.getPageCount()).toBe(3)
    expect(result.buffer.length).toBeGreaterThan(source.length * 0.8)
  })

  it('bevorzugt erkannte Lücken-Geometrie gegenüber falscher Vision-bbox', async () => {
    const source = await worksheetPdf(1)
    const blanks = await detectPdfBlankRegions(source)
    expect(blanks.length).toBeGreaterThanOrEqual(1)

    const result = await overlayPdfAnswers(source, {
      summary: 'Hybrid',
      answers: [
        {
          id: '1',
          label: '1',
          answer: 'Photosynthese',
          page: 1,
          blankIndex: 0,
          // Absichtlich weit daneben (unterer Seitenbereich).
          bbox: { x: 0.5, y: 0.85, w: 0.3, h: 0.03 },
        },
      ],
      formFields: [],
    })

    expect(result.overlays).toBe(1)
    expect(result.usedGeometry).toBe(1)
    expect(result.usedBBox).toBe(0)

    const { loadPdfjs } = await import('../../server/utils/pdfjs')
    const pdfjs = await loadPdfjs()
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(result.buffer),
      useSystemFonts: true,
      verbosity: 0,
    }).promise
    const page = await doc.getPage(1)
    const content = await page.getTextContent()
    const overlay = content.items.find(
      (item) => 'str' in item && item.str === 'Photosynthese',
    ) as { str: string; transform: number[] } | undefined
    expect(overlay).toBeTruthy()
    const y = overlay!.transform[5]!
    // Muss nahe der Unterstrich-Lücke liegen, nicht bei yNorm=0.85 (unten).
    expect(y).toBeGreaterThan(680)
    expect(y).toBeLessThan(720)
  })

  it('bevorzugt gespeicherte bbox bei preferBBox (Nachbearbeitung)', async () => {
    const source = await worksheetPdf(1)
    const result = await overlayPdfAnswers(
      source,
      {
        summary: 'Korrigiert',
        answers: [
          {
            id: '1',
            label: '1',
            answer: 'Manuell',
            page: 1,
            blankIndex: 0,
            fieldType: 'luecke',
            bbox: { x: 0.15, y: 0.2, w: 0.4, h: 0.03 },
          },
        ],
        formFields: [],
      },
      { preferBBox: true },
    )
    expect(result.overlays).toBe(1)
    expect(result.usedBBox).toBe(1)
    expect(result.usedGeometry).toBe(0)
  })

  it('nutzt Heuristik ohne bbox/Geometrie und behält Originalseiten', async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage([595.28, 841.89])
    pdf.addPage([595.28, 841.89])
    const source = Buffer.from(await pdf.save())

    const result = await overlayPdfAnswers(source, {
      summary: 'Ohne Koordinaten',
      answers: [
        { id: '1', label: '1a', answer: 'Antwort A', page: 1, blankIndex: 0 },
        { id: '2', label: '1b', answer: 'Antwort B', page: 1, blankIndex: 1 },
        { id: '3', label: '2', answer: 'Antwort C', page: 2, blankIndex: 0 },
      ],
      formFields: [],
    })

    expect(result.overlays).toBe(3)
    expect(result.usedBBox).toBe(0)
    expect(result.usedGeometry).toBe(0)
    const loaded = await PDFDocument.load(result.buffer)
    expect(loaded.getPageCount()).toBe(2)
  })
})
