import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { analyzeDocxTargets } from '../../../server/services/ai/solutions/docx-analyzer'
import { fillDocxDocument } from '../../../server/services/ai/document-fill'

function docxWith(bodyInner: string): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyInner}<w:sectPr/></w:body>
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
    zipSync({
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rels),
      'word/document.xml': strToU8(documentXml),
    }),
  )
}

describe('analyzeDocxTargets', () => {
  it('findet Content Controls und Bookmarks', () => {
    const source = docxWith(`
      <w:sdt>
        <w:sdtPr><w:alias w:val="Lücke 1"/><w:tag w:val="Lücke 1"/></w:sdtPr>
        <w:sdtContent><w:r><w:t>___</w:t></w:r></w:sdtContent>
      </w:sdt>
      <w:bookmarkStart w:id="1" w:name="Aufgabe1"/>
      <w:r><w:t>Text</w:t></w:r>
      <w:bookmarkEnd w:id="1"/>
    `)
    const analysis = analyzeDocxTargets(source)
    expect(analysis.nativeFields.some((f) => f.kind === 'content_control')).toBe(true)
    expect(analysis.nativeFields.some((f) => f.name === 'Aufgabe1')).toBe(true)
    expect(analysis.targets.length).toBeGreaterThanOrEqual(2)
  })
})

describe('fillDocxDocument appendix bookmark', () => {
  it('hängt Lösungsabschnitt mit Bookmark an, wenn keine Lücken', () => {
    const source = docxWith(`<w:p><w:r><w:t>Beschreiben Sie die GUI.</w:t></w:r></w:p>`)
    const result = fillDocxDocument(
      source,
      {
        summary: 'Offen',
        answers: [
          {
            id: '1',
            label: 'Aufgabe 1',
            answer: 'Die GUI zeigt A und B.',
            fieldType: 'freitext',
            blankIndex: null,
          },
        ],
        formFields: [],
      },
      { notice: 'Hinweis' },
    )
    expect(result.strategy).toBe('docx_appended')
    const files = unzipSync(new Uint8Array(result.buffer))
    const xml = strFromU8(files['word/document.xml']!)
    expect(xml).toContain('saru-loesung')
    expect(xml).toContain('Musterlösung')
  })
})
