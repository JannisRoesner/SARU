import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import {
  alignAnswersToBlanks,
  blankRegionToBBox,
  buildSolutionDocx,
  classifySolutionFillMode,
  detectDocxBlanks,
  detectPdfBlankRegions,
  enrichSolutionPlacements,
  fillDocxDocument,
  fillPdfAcroForm,
  filterReliableBlanks,
  formatBlankInventory,
  formatTextBlankInventory,
  inferAnswerFieldType,
  buildAnswerListPdf,
  looksLikeClozeGap,
  overlayPdfAnswers,
  parseStructuredSolution,
  sanitizePdfText,
  solutionToMarkdown,
  topLeftNormToPdfBaseline,
  type PdfBlankRegion,
} from '../../server/services/ai/document-fill'
import {
  buildSolutionPrompt,
  resolveSolutionFillMode,
  solutionSystemPromptForMode,
} from '../../server/services/ai/prompts'
import { overlayFieldType, overlayFontSizePx } from '../../shared/utils/solution-overlay'

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

describe('enrichSolutionPlacements', () => {
  it('überschreibt Vision-bbox mit PDF-Geometrie bei blankIndex', () => {
    const blank: PdfBlankRegion = {
      pageIndex: 0,
      blankIndex: 0,
      x: 100,
      y: 700,
      width: 120,
      height: 14,
      kind: 'underscore',
      leftText: 'Die',
      rightText: 'ist',
    }
    const page = { width: 595.28, height: 841.89 }
    const geo = blankRegionToBBox(blank, page.width, page.height)
    const enriched = enrichSolutionPlacements(
      {
        summary: 'Test',
        answers: [
          {
            id: '1',
            label: '1',
            answer: 'Antwort',
            page: 1,
            blankIndex: 0,
            bbox: { x: 0.5, y: 0.85, w: 0.3, h: 0.03 },
          },
        ],
        formFields: [],
      },
      [blank],
      [page],
    )
    expect(enriched.answers[0]!.bbox).toEqual(geo)
    expect(enriched.answers[0]!.bbox!.y).toBeLessThan(0.3)
  })

  it('lässt manuelle bbox ohne blankIndex unverändert', () => {
    const manual = { x: 0.15, y: 0.22, w: 0.4, h: 0.03 }
    const enriched = enrichSolutionPlacements(
      {
        summary: 'Test',
        answers: [
          {
            id: '1',
            label: '1',
            answer: 'Manuell',
            page: 1,
            blankIndex: null,
            bbox: manual,
          },
        ],
        formFields: [],
      },
      [
        {
          pageIndex: 0,
          blankIndex: 0,
          x: 100,
          y: 700,
          width: 120,
          height: 14,
          kind: 'underscore',
          leftText: '',
          rightText: '',
        },
      ],
      [{ width: 595.28, height: 841.89 }],
    )
    expect(enriched.answers[0]!.bbox).toEqual(manual)
  })
})

describe('overlayFontSizePx', () => {
  it('skaliert Lücken- und Freitextschrift analog zum PDF', () => {
    expect(overlayFontSizePx(20, 'luecke')).toBe(Math.min(14, Math.max(8, 20 * 0.85)))
    expect(overlayFontSizePx(80, 'freitext')).toBe(Math.min(11, Math.max(7, 80 * 0.2)))
  })
})

describe('overlayFieldType', () => {
  it('respektiert expliziten Typ und leitet hohe Boxen als Freitext ab', () => {
    expect(overlayFieldType({ fieldType: 'luecke', bboxH: 0.2 })).toBe('luecke')
    expect(overlayFieldType({ fieldType: 'freitext', bboxH: 0.02 })).toBe('freitext')
    expect(overlayFieldType({ bboxH: 0.08, answer: 'kurz' })).toBe('freitext')
    expect(overlayFieldType({ bboxH: 0.02, answer: 'kurz' })).toBe('luecke')
    expect(overlayFieldType({ bboxH: 0.02, answer: 'a'.repeat(100) })).toBe('freitext')
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
    expect(xml).toContain('w:val="1F4E9B"')
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

  it('füllt Unterstriche, die Word auf mehrere Runs aufteilt', () => {
    // Typisch: „Die“ | „___“ | „___“ | „ des Penis“ in getrennten <w:t>.
    const blanked = minimalDocxWithBody(`
      <w:p>
        <w:r><w:t>Die </w:t></w:r>
        <w:r><w:t>___</w:t></w:r>
        <w:r><w:t>___</w:t></w:r>
        <w:r><w:t> des Penis</w:t></w:r>
      </w:p>
      <w:p>
        <w:r><w:t>ist sie sehr </w:t></w:r>
        <w:r><w:t>....</w:t></w:r>
        <w:r><w:t>.</w:t></w:r>
      </w:p>
    `)

    const detected = detectDocxBlanks(blanked)
    expect(detected.length).toBeGreaterThanOrEqual(2)
    expect(formatTextBlankInventory(detected)).toContain('Die')
    expect(classifySolutionFillMode(detected)).toBe('lueckentext')

    const filled = fillDocxDocument(blanked, {
      summary: 'Test',
      answers: [
        { id: '1', label: '1', answer: 'Eichel', blankIndex: 0 },
        { id: '2', label: '2', answer: 'lang', blankIndex: 1 },
      ],
      formFields: [],
    })

    expect(filled.strategy).toBe('docx_inplace')
    expect(filled.filled).toBeGreaterThanOrEqual(2)
    const xml = strFromU8(unzipSync(new Uint8Array(filled.buffer))['word/document.xml']!)
    expect(xml).toContain('Eichel')
    expect(xml).toContain('lang')
    expect(xml).toContain('w:val="1F4E9B"')
    expect(xml).not.toMatch(/_{3,}/)
  })

  it('schreibt Einfach-Lücken in blauer Schrift ins DOCX', () => {
    const blanked = minimalDocxWithBody(`
      <w:p><w:r><w:t>Frage: ______</w:t></w:r></w:p>
    `)
    const filled = fillDocxDocument(blanked, {
      summary: 'Test',
      answers: [{ id: '1', label: '1', answer: 'Meiose' }],
      formFields: [],
    })
    expect(filled.strategy).toBe('docx_inplace')
    const xml = strFromU8(unzipSync(new Uint8Array(filled.buffer))['word/document.xml']!)
    expect(xml).toContain('Meiose')
    expect(xml).toContain('<w:color w:val="1F4E9B"/>')
    expect(xml).not.toContain('______')
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
    expect(classifySolutionFillMode(blanks)).toBe('lueckentext')
  })

  it('erkennt in durchgehendem Fließtext keine Lücken (offene Aufgabe)', async () => {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const page = pdf.addPage([595.28, 841.89])
    const lines = [
      'Beschreiben Sie die in der GUI dargestellten Komponenten im Sachzusammenhang.',
      'Material 1: Zur Unterstützung der Fluglotsen soll eine Software erstellt werden,',
      'die das Nachtflugverbot zwischen 23:00 Uhr und 05:00 Uhr umsetzt. Verspätete',
      'Flugzeuge, deren geplante Ankunftszeit vor 23:00 Uhr liegt, dürfen bis 24:00 Uhr',
      'landen. Danach werden sie umgeleitet, sofern keine manuelle Ausnahmegenehmigung',
      'vorliegt. Jeder Flug wird durch eine Flugnummer eindeutig identifiziert.',
    ]
    let y = 720
    for (const line of lines) {
      page.drawText(line, { x: 50, y, size: 11, font })
      y -= 18
    }
    // Simulierter Blocksatz: viele Wort-Runs mit mäßigen Abständen auf einer Zeile.
    const words = ['Jeder', 'Flug', 'wird', 'durch', 'eine', 'Flugnummer', 'eindeutig', 'identifiziert.']
    let x = 50
    for (const word of words) {
      page.drawText(word, { x, y: 580, size: 11, font })
      x += font.widthOfTextAtSize(word, 11) + 18
    }
    const source = Buffer.from(await pdf.save())

    const blanks = await detectPdfBlankRegions(source)
    expect(blanks).toHaveLength(0)
    expect(classifySolutionFillMode(blanks)).toBe('offen')
  })
})

describe('looksLikeClozeGap / filterReliableBlanks', () => {
  it('akzeptiert typische Lückentext-Kontexte und verwirft Fließtext-Hälften', () => {
    expect(
      looksLikeClozeGap({
        kind: 'gap',
        leftText: 'Die',
        rightText: 'des Penis ist bedeckt.',
        width: 80,
      }),
    ).toBe(true)
    expect(
      looksLikeClozeGap({
        kind: 'gap',
        leftText: 'ist sie sehr',
        rightText: 'und steht vorne.',
        width: 90,
      }),
    ).toBe(true)
    expect(
      looksLikeClozeGap({
        kind: 'gap',
        leftText: 'die das Nachtflugverbot zwischen 23:00 Uhr und',
        rightText: '05:00 Uhr umsetzt. Verspätete Flugzeuge werden umgeleitet.',
        width: 40,
      }),
    ).toBe(false)
  })

  it('filtert unzuverlässige Gaps aus der Inventarliste', () => {
    const filtered = filterReliableBlanks([
      {
        pageIndex: 0,
        blankIndex: 0,
        x: 70,
        y: 500,
        width: 80,
        height: 12,
        kind: 'underscore',
        leftText: 'Die',
        rightText: 'ist',
      },
      {
        pageIndex: 0,
        blankIndex: 1,
        x: 100,
        y: 400,
        width: 50,
        height: 12,
        kind: 'gap',
        leftText: 'lange Sachtextpassage über Nachtflugverbote und Ausnahmen',
        rightText: 'weitere lange Sachtextpassage ohne echte Antwortlücke hier',
      },
    ])
    expect(filtered).toHaveLength(1)
    expect(filtered[0]!.kind).toBe('underscore')
    expect(filtered[0]!.blankIndex).toBe(0)
  })
})

describe('solution fill mode prompts', () => {
  it('wählt offenen Prompt ohne Lückeninventar', () => {
    const prompt = buildSolutionPrompt({
      title: 'Nachtflugverbot',
      subjects: ['Informatik'],
      gradeLevels: [],
      topics: [],
      competencies: [],
      learningObjectives: [],
      fillMode: 'offen',
      blankInventory: null,
    })
    expect(resolveSolutionFillMode({ title: 'x', subjects: [], gradeLevels: [], topics: [], competencies: [], learningObjectives: [], fillMode: 'offen' })).toBe('offen')
    expect(prompt).toContain('separates PDF')
    expect(prompt).toContain('Füllmodus: offen')
    expect(prompt).not.toContain('verbindliche blankIndex-Liste')
    expect(solutionSystemPromptForMode('offen')).toContain('separates Dokument')
    expect(solutionSystemPromptForMode('offen')).not.toContain('sichtbare Lücken im Fließtext')
  })

  it('erzeugt ein separates PDF mit Aufgabennummer und Lösung', async () => {
    const buffer = await buildAnswerListPdf(
      'Musterlösung – Nachtflugverbot',
      {
        summary: 'Erwartungshorizont zur GUI-Beschreibung.',
        answers: [
          {
            id: '1',
            label: 'Aufgabe 1',
            answer: 'Flugnummer-Feld zur Identifikation; Buttons Pruefen/Erteilen.',
            fieldType: 'freitext',
          },
        ],
        formFields: [],
      },
      { notice: 'Von künstlicher Intelligenz erstellt.' },
    )
    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-')
    const pdf = await PDFDocument.load(buffer)
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1)
  })

  it('behält Lückentext-Prompt mit Inventar', () => {
    const prompt = buildSolutionPrompt({
      title: 'Lückentext',
      subjects: [],
      gradeLevels: [],
      topics: [],
      competencies: [],
      learningObjectives: [],
      fillMode: 'lueckentext',
      blankInventory: '0: „Die ___ des Penis“ (Seite 1)',
      detectedBlankCount: 1,
    })
    expect(prompt).toContain('verbindliche blankIndex-Liste')
    expect(prompt).toContain('Die ___ des Penis')
    expect(solutionSystemPromptForMode('lueckentext')).toContain('in die Lücken gelegt')
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
