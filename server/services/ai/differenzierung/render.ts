import { strToU8, zipSync } from 'fflate'
import type { DifferentiatedWorksheet } from './prompts'

const NOTICE =
  'Von künstlicher Intelligenz erstellt. Diese Differenzierungsfassung wurde automatisch generiert und ist fachlich noch nicht geprüft. Bitte vor dem Einsatz im Unterricht kontrollieren.'

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function paragraph(text: string, options: { bold?: boolean; italic?: boolean; size?: number } = {}): string {
  const lines = text.split('\n').map((line) => escapeXml(line))
  const rPrParts: string[] = []
  if (options.bold) rPrParts.push('<w:b/>')
  if (options.italic) rPrParts.push('<w:i/>')
  if (options.size) rPrParts.push(`<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>`)
  const rPr = rPrParts.length ? `<w:rPr>${rPrParts.join('')}</w:rPr>` : ''
  const runs = lines
    .map((line, index) => {
      const br = index < lines.length - 1 ? '<w:br/>' : ''
      return `<w:r>${rPr}<w:t xml:space="preserve">${line}</w:t>${br}</w:r>`
    })
    .join('')
  return `<w:p>${runs}</w:p>`
}

function heading(text: string): string {
  return paragraph(text, { bold: true, size: 28 })
}

/** Baut ein einfaches Word-Dokument aus der strukturierten Differenzierungsfassung. */
export function buildWorksheetDocx(
  sheet: DifferentiatedWorksheet,
  options: { profileLabel: string; notice?: string } = { profileLabel: '' },
): Buffer {
  const body: string[] = [
    paragraph(sheet.title, { bold: true, size: 36 }),
    paragraph(`${options.profileLabel} · KI-Fassung`, { italic: true, size: 20 }),
    paragraph(options.notice ?? NOTICE, { italic: true, size: 18 }),
  ]

  if (sheet.intro) body.push(paragraph(sheet.intro))

  for (const task of sheet.tasks) {
    const title = task.title ? `Aufgabe ${task.number}: ${task.title}` : `Aufgabe ${task.number}`
    body.push(heading(title))
    body.push(paragraph(task.prompt))
    if (task.hints.length) {
      body.push(paragraph('Hinweise:', { italic: true }))
      for (const hint of task.hints) body.push(paragraph(`• ${hint}`))
    }
    if (task.figureNote) body.push(paragraph(task.figureNote, { italic: true }))
  }

  if (sheet.wordBank.length) {
    body.push(heading('Wortspeicher'))
    body.push(paragraph(sheet.wordBank.join(' · ')))
  }

  if (sheet.glossary.length) {
    body.push(heading('Glossar'))
    for (const item of sheet.glossary) {
      body.push(paragraph(`${item.term}: ${item.explanation}`))
    }
  }

  if (sheet.uncertainties) {
    body.push(heading('Hinweise zur Prüfung'))
    body.push(paragraph(sheet.uncertainties))
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body.join('\n')}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
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

  const packed = zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rels),
      'word/document.xml': strToU8(documentXml),
    },
    { level: 6 },
  )
  return Buffer.from(packed)
}
