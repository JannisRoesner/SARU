import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { createLogger } from '../../utils/logger'
import { loadPdfjs } from '../../utils/pdfjs'

const log = createLogger('ai:document-fill')

/** Normierte Lückenposition (0–1), Ursprung oben links – wie Vision-Modelle Seitenbilder sehen. */
export interface SolutionBBox {
  x: number
  y: number
  w?: number
  h?: number
}

/** Kurze Einwort-/Phasenlücke vs. längerer mehrzeiliger Antwortbereich. */
export type SolutionFieldType = 'luecke' | 'freitext'

export interface SolutionAnswer {
  id: string
  label: string
  answer: string
  page?: number | null
  /** 0-basierter Index einer Lücke (Unterstriche/Platzhalter) im Dokument. */
  blankIndex?: number | null
  /** Text links der Lücke (vom Modell oder aus der Geometrie). */
  leftContext?: string | null
  /** Text rechts der Lücke (vom Modell oder aus der Geometrie). */
  rightContext?: string | null
  /** Position der Lücke auf der Seite (normiert 0–1, Ursprung oben links). */
  bbox?: SolutionBBox | null
  /** Darstellungs-/Overlay-Typ; Autoren können ihn nachträglich ändern. */
  fieldType?: SolutionFieldType | null
}

export interface SolutionFormField {
  name: string
  value: string
}

export interface StructuredSolution {
  summary: string
  answers: SolutionAnswer[]
  formFields: SolutionFormField[]
  notesForTeacher?: string | null
  uncertainties?: string | null
}

export type FillStrategy =
  | 'docx_inplace'
  | 'docx_appended'
  | 'pdf_acroform'
  | 'pdf_overlay'
  /** Separates blankes PDF mit Aufgabennummer + Lösung (offene Aufgaben). */
  | 'pdf_separate'
  | 'docx_from_structure'
  | 'hermes'

export interface FilledDocument {
  buffer: Buffer
  fileName: string
  mimeType: string
  strategy: FillStrategy
  summary: string
}

const SOLUTION_INK = rgb(0.12, 0.22, 0.55)

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function parseBBox(raw: unknown): SolutionBBox | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const x = Number(row.x ?? row.left)
  const y = Number(row.y ?? row.top)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  const wRaw = row.w ?? row.width
  const hRaw = row.h ?? row.height
  const w = wRaw == null ? undefined : Number(wRaw)
  const h = hRaw == null ? undefined : Number(hRaw)
  return {
    x: clamp01(x > 1 && x <= 100 ? x / 100 : x),
    y: clamp01(y > 1 && y <= 100 ? y / 100 : y),
    w: w != null && Number.isFinite(w) ? clamp01(w > 1 && w <= 100 ? w / 100 : w) : undefined,
    h: h != null && Number.isFinite(h) ? clamp01(h > 1 && h <= 100 ? h / 100 : h) : undefined,
  }
}

/** Extrahiert strukturierte Lösung aus LLM-Text (JSON oder Markdown-Fence). */
export function parseStructuredSolution(raw: string): StructuredSolution {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1]?.trim() ?? trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) {
    return {
      summary: 'Automatisch erstellte Musterlösung (Freitext).',
      answers: [{ id: '1', label: 'Lösung', answer: trimmed }],
      formFields: [],
    }
  }

  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>
    const answersRaw = Array.isArray(parsed.answers) ? parsed.answers : []
    const fieldsRaw = Array.isArray(parsed.formFields) ? parsed.formFields : []

    const answers: SolutionAnswer[] = []
    for (const [index, entry] of answersRaw.entries()) {
      if (!entry || typeof entry !== 'object') continue
      const row = entry as Record<string, unknown>
      const answer = String(row.answer ?? row.value ?? '').trim()
      if (!answer) continue
      const nestedBBox = parseBBox(row.bbox ?? row.box ?? row.rect)
      const flatBBox =
        nestedBBox ??
        parseBBox({
          x: row.x,
          y: row.y,
          w: row.w ?? row.width,
          h: row.h ?? row.height,
        })
      const leftContext = String(
        row.leftContext ?? row.contextBefore ?? row.before ?? '',
      ).trim()
      const rightContext = String(
        row.rightContext ?? row.contextAfter ?? row.after ?? '',
      ).trim()
      const fieldRaw = String(row.fieldType ?? row.type ?? '').toLowerCase()
      const fieldType: SolutionFieldType | null =
        fieldRaw === 'freitext' || fieldRaw === 'textarea' || fieldRaw === 'long'
          ? 'freitext'
          : fieldRaw === 'luecke' || fieldRaw === 'blank' || fieldRaw === 'short'
            ? 'luecke'
            : null
      answers.push({
        id: String(row.id ?? index + 1),
        label: String(row.label ?? row.task ?? `Aufgabe ${index + 1}`),
        answer,
        page: typeof row.page === 'number' ? row.page : null,
        blankIndex: typeof row.blankIndex === 'number' ? row.blankIndex : null,
        leftContext: leftContext || null,
        rightContext: rightContext || null,
        bbox: flatBBox,
        fieldType,
      })
    }

    const formFields: SolutionFormField[] = fieldsRaw
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null
        const row = entry as Record<string, unknown>
        const name = String(row.name ?? '').trim()
        const value = String(row.value ?? '').trim()
        if (!name || !value) return null
        return { name, value }
      })
      .filter((row): row is SolutionFormField => row !== null)

    if (answers.length === 0 && formFields.length === 0) {
      const fallback = String(parsed.summary ?? parsed.text ?? trimmed).trim()
      return {
        summary: 'Automatisch erstellte Musterlösung.',
        answers: fallback ? [{ id: '1', label: 'Lösung', answer: fallback }] : [],
        formFields: [],
      }
    }

    return {
      summary: String(parsed.summary ?? 'Automatisch erstellte Musterlösung.').trim(),
      answers,
      formFields,
      notesForTeacher: parsed.notesForTeacher ? String(parsed.notesForTeacher) : null,
      uncertainties: parsed.uncertainties ? String(parsed.uncertainties) : null,
    }
  } catch (error) {
    log.warn('Strukturierte Lösung konnte nicht geparst werden – Freitext-Fallback', error)
    return {
      summary: 'Automatisch erstellte Musterlösung (Freitext).',
      answers: [{ id: '1', label: 'Lösung', answer: trimmed }],
      formFields: [],
    }
  }
}

export function solutionToMarkdown(solution: StructuredSolution): string {
  const lines: string[] = []
  if (solution.summary) lines.push(solution.summary, '')
  for (const answer of solution.answers) {
    const page = answer.page ? ` (S. ${answer.page})` : ''
    lines.push(`### ${answer.label}${page}`, '', answer.answer, '')
  }
  if (solution.notesForTeacher) {
    lines.push('### Hinweise für die Lehrkraft', '', solution.notesForTeacher, '')
  }
  if (solution.uncertainties) {
    lines.push('### Unklarheiten', '', solution.uncertainties, '')
  }
  return lines.join('\n').trim()
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function paragraphsToDocxXml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
  if (paragraphs.length === 0) {
    return '<w:p><w:r><w:t></w:t></w:r></w:p>'
  }
  return paragraphs
    .map((block) => {
      const lines = block.split('\n').map((line) => escapeXml(line))
      const runs = lines
        .map((line, index) => {
          const br = index < lines.length - 1 ? '<w:br/>' : ''
          return `<w:r><w:t xml:space="preserve">${line}</w:t>${br}</w:r>`
        })
        .join('')
      return `<w:p>${runs}</w:p>`
    })
    .join('')
}

/** Erzeugt ein minimales DOCX mit der Lösung als Fließtext. */
export function buildSolutionDocx(
  title: string,
  solution: StructuredSolution,
  options: { notice?: string } = {},
): Buffer {
  const bodyParts = [
    `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${escapeXml(title)}</w:t></w:r></w:p>`,
  ]
  if (options.notice) bodyParts.push(paragraphsToDocxXml(options.notice))
  bodyParts.push(paragraphsToDocxXml(solutionToMarkdown(solution)))

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyParts.join('\n')}
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

/** Lückenmuster in Word-Text (auch über Run-Grenzen hinweg zusammengefügt). */
const BLANK_PATTERN = /(?:_{3,}|\.{3,}|…{2,}|\[[\s_.…]{2,}\])/g

/** Infos zu Text-Lücken in DOCX (ohne PDF-Geometrie). */
export interface TextBlankInfo {
  blankIndex: number
  leftText: string
  rightText: string
}

function orderedAnswerTexts(solution: StructuredSolution): string[] {
  const byBlank = [...solution.answers]
    .filter((a) => typeof a.blankIndex === 'number')
    .sort((a, b) => (a.blankIndex ?? 0) - (b.blankIndex ?? 0))
    .map((a) => a.answer)
  if (byBlank.length) return byBlank
  return solution.answers.map((a) => a.answer)
}

interface DocxTextNode {
  /** Index des Match-Starts im XML. */
  xmlStart: number
  open: string
  text: string
  close: string
  /** Start-Offset dieses Knotens im zusammengefügten Klartext. */
  plainStart: number
}

function collectDocxTextNodes(xml: string): DocxTextNode[] {
  const nodes: DocxTextNode[] = []
  const re = /(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g
  let match: RegExpExecArray | null
  let plainStart = 0
  while ((match = re.exec(xml)) != null) {
    const open = match[1]!
    const text = match[2]!
    const close = match[3]!
    nodes.push({
      xmlStart: match.index,
      open,
      text,
      close,
      plainStart,
    })
    plainStart += text.length
  }
  return nodes
}

function decodeXmlText(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

/**
 * Findet Unterstrich-/Punktlücken in DOCX-document.xml, auch wenn Word die
 * Unterstriche auf mehrere <w:t>-Runs aufgeteilt hat.
 */
export function detectDocxBlanks(source: Buffer): TextBlankInfo[] {
  const files = unzipSync(new Uint8Array(source))
  const docEntry = files['word/document.xml']
  if (!docEntry) return []
  const xml = strFromU8(docEntry)
  const nodes = collectDocxTextNodes(xml)
  const plain = nodes.map((n) => decodeXmlText(n.text)).join('')
  const blanks: TextBlankInfo[] = []
  const pattern = new RegExp(BLANK_PATTERN.source, 'g')
  let match: RegExpExecArray | null
  while ((match = pattern.exec(plain)) != null) {
    const start = match.index
    const end = start + match[0].length
    blanks.push({
      blankIndex: blanks.length,
      leftText: plain.slice(Math.max(0, start - 56), start).replace(/\s+/g, ' ').trim(),
      rightText: plain.slice(end, end + 56).replace(/\s+/g, ' ').trim(),
    })
  }
  return blanks
}

export function formatTextBlankInventory(blanks: TextBlankInfo[]): string {
  if (blanks.length === 0) return ''
  return blanks
    .map((blank) => {
      const left = blank.leftText || '…'
      const right = blank.rightText || '…'
      return `${blank.blankIndex}: „${left} ___ ${right}“`
    })
    .join('\n')
}

/** Blaue Tinte für eingefügte Musterlösungs-Antworten in Word (ähnlich PDF-Overlay). */
const SOLUTION_DOCX_COLOR = '1F4E9B'

function docxTextRun(text: string, asAnswer = false): string {
  if (!text) return ''
  const color = asAnswer
    ? `<w:rPr><w:color w:val="${SOLUTION_DOCX_COLOR}"/><w:b/></w:rPr>`
    : ''
  return `<w:r>${color}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
}

/**
 * Füllt Lücken in einem Absatz: Klartext über alle <w:t> zusammenfügen
 * (Word splittet Unterstriche oft auf mehrere Runs), Antworten in blauer Schrift einsetzen.
 */
function fillBlanksInParagraphXml(
  paragraphXml: string,
  answers: string[],
  cursor: { index: number },
): { xml: string; replaced: number } {
  const nodes = collectDocxTextNodes(paragraphXml)
  if (nodes.length === 0) return { xml: paragraphXml, replaced: 0 }

  const plain = nodes.map((n) => decodeXmlText(n.text)).join('')
  if (!new RegExp(BLANK_PATTERN.source).test(plain)) {
    return { xml: paragraphXml, replaced: 0 }
  }

  const openTag = paragraphXml.match(/^<w:p\b[^>]*>/)?.[0]
  if (!openTag) return { xml: paragraphXml, replaced: 0 }
  const pPr = paragraphXml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] ?? ''

  type Segment = { text: string; answer: boolean }
  const segments: Segment[] = []
  const pattern = new RegExp(BLANK_PATTERN.source, 'g')
  let replaced = 0
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(plain)) != null) {
    if (match.index > last) {
      segments.push({ text: plain.slice(last, match.index), answer: false })
    }
    const value = answers[cursor.index]
    if (value == null) {
      segments.push({ text: match[0], answer: false })
    } else {
      cursor.index += 1
      replaced += 1
      segments.push({ text: value, answer: true })
    }
    last = match.index + match[0].length
  }
  if (last < plain.length) {
    segments.push({ text: plain.slice(last), answer: false })
  }
  if (replaced === 0) return { xml: paragraphXml, replaced: 0 }

  const runs = segments.map((seg) => docxTextRun(seg.text, seg.answer)).join('')
  return {
    xml: `${openTag}${pPr}${runs}</w:p>`,
    replaced,
  }
}

/** Ersetzt Lücken dokumentweit, absatzweise (robust gegen Word-Run-Splitting). */
function fillBlanksAcrossDocxRuns(xml: string, answers: string[]): { xml: string; replaced: number } {
  const cursor = { index: 0 }
  let replaced = 0
  const next = xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraphXml) => {
    const result = fillBlanksInParagraphXml(paragraphXml, answers, cursor)
    replaced += result.replaced
    return result.xml
  })
  return { xml: next, replaced }
}

/**
 * Füllt Lücken in einem DOCX: Content Controls (Alias/Tag) und Unterstrich-/Punktmuster.
 * Lücken dürfen über mehrere Word-Runs verteilt sein.
 * Wenn nichts ersetzt werden kann, wird eine Abschnitts-Musterlösung angehängt.
 */
export function fillDocxDocument(
  source: Buffer,
  solution: StructuredSolution,
  options: { title?: string; notice?: string } = {},
): { buffer: Buffer; strategy: 'docx_inplace' | 'docx_appended'; filled: number } {
  const files = unzipSync(new Uint8Array(source))
  const docEntry = files['word/document.xml']
  if (!docEntry) {
    return {
      buffer: buildSolutionDocx(options.title ?? 'Musterlösung', solution, {
        notice: options.notice,
      }),
      strategy: 'docx_appended',
      filled: 0,
    }
  }

  let xml = strFromU8(docEntry)
  let replaced = 0
  const answers = orderedAnswerTexts(solution)

  // Content Controls mit Alias/Tag, die zu Antwort-Labels passen.
  xml = xml.replace(
    /<w:sdt>([\s\S]*?)<\/w:sdt>/g,
    (full, inner: string) => {
      const alias =
        inner.match(/<w:alias[^>]*w:val="([^"]+)"/)?.[1] ??
        inner.match(/<w:tag[^>]*w:val="([^"]+)"/)?.[1] ??
        ''
      if (!alias) return full
      const match =
        solution.answers.find((a) => a.label.toLowerCase() === alias.toLowerCase()) ??
        solution.answers.find((a) => a.id === alias) ??
        solution.formFields.find((f) => f.name.toLowerCase() === alias.toLowerCase())
      const value =
        match && 'answer' in match
          ? match.answer
          : match && 'value' in match
            ? match.value
            : null
      if (!value) return full
      replaced += 1
      const content = inner.replace(
        /<w:sdtContent>([\s\S]*?)<\/w:sdtContent>/,
        `<w:sdtContent>${docxTextRun(value, true)}</w:sdtContent>`,
      )
      return `<w:sdt>${content}</w:sdt>`
    },
  )

  const across = fillBlanksAcrossDocxRuns(xml, answers)
  xml = across.xml
  replaced += across.replaced

  if (replaced > 0) {
    files['word/document.xml'] = strToU8(xml)
    return {
      buffer: Buffer.from(zipSync(files, { level: 6 })),
      strategy: 'docx_inplace',
      filled: replaced,
    }
  }

  // Keine Lücken gefunden → Abschnitt anhängen, Original bleibt lesbar.
  const appendix = [
    '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Musterlösung (KI)</w:t></w:r></w:p>',
    options.notice ? paragraphsToDocxXml(options.notice) : '',
    paragraphsToDocxXml(solutionToMarkdown(solution)),
  ].join('')

  const injected = xml.replace(
    /<\/w:body>/i,
    `${appendix}</w:body>`,
  )
  files['word/document.xml'] = strToU8(injected)
  return {
    buffer: Buffer.from(zipSync(files, { level: 6 })),
    strategy: 'docx_appended',
    filled: 0,
  }
}

/** Füllt AcroForm-Felder, sofern vorhanden. */
export async function fillPdfAcroForm(
  source: Buffer,
  solution: StructuredSolution,
): Promise<{ buffer: Buffer; filled: number } | null> {
  try {
    const pdf = await PDFDocument.load(source, { ignoreEncryption: true })
    const form = pdf.getForm()
    const fields = form.getFields()
    if (fields.length === 0) return null

    let filled = 0
    const byName = new Map(solution.formFields.map((f) => [f.name.toLowerCase(), f.value]))
    const sequential = orderedAnswerTexts(solution)
    let seq = 0

    for (const field of fields) {
      const name = field.getName()
      const value = byName.get(name.toLowerCase()) ?? sequential[seq]
      if (value == null) continue
      try {
        const anyField = field as {
          setText?: (v: string) => void
          check?: () => void
          select?: (v: string) => void
        }
        if (typeof anyField.setText === 'function') {
          anyField.setText(value)
          filled += 1
          if (!byName.has(name.toLowerCase())) seq += 1
        } else if (typeof anyField.select === 'function') {
          anyField.select(value)
          filled += 1
          if (!byName.has(name.toLowerCase())) seq += 1
        } else if (/^(true|ja|x|1|yes)$/i.test(value) && typeof anyField.check === 'function') {
          anyField.check()
          filled += 1
          if (!byName.has(name.toLowerCase())) seq += 1
        }
      } catch (error) {
        log.debug('PDF-Feld konnte nicht gesetzt werden', { name, error })
      }
    }

    if (filled === 0) return null
    form.flatten()
    return { buffer: Buffer.from(await pdf.save()), filled }
  } catch (error) {
    log.warn('PDF-AcroForm-Füllung fehlgeschlagen', error)
    return null
  }
}

/**
 * WinAnsi-sichere Variante für StandardFonts (Helvetica): deutsche Umlaute bleiben,
 * typografische Zeichen werden ersetzt, unbekannte Glyphs entfallen.
 */
export function sanitizePdfText(text: string): string {
  const mapped = text
    .normalize('NFC')
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/\u2044/g, '/')
    .replace(/[‐‑‒–—―]/g, '-')

  let out = ''
  for (const ch of mapped) {
    const code = ch.codePointAt(0) ?? 0
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      out += ch === '\t' ? ' ' : '\n'
      continue
    }
    if (code < 32) continue
    if (code <= 0xff) {
      out += ch
      continue
    }
    // Häufige deutsche Sonderfälle außerhalb Latin-1 sind bereits NFC-normalisiert.
  }
  return out.replace(/[^\S\n]+/g, ' ').trim()
}

function wrapTextToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const paragraphs = text.split(/\n/).map((p) => p.trim()).filter(Boolean)
  if (paragraphs.length === 0) return []
  const lines: string[] = []

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    let line = ''
    for (const word of words) {
      const next = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(next, size) <= maxWidth) {
        line = next
        continue
      }
      if (line) lines.push(line)
      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        line = word
        continue
      }
      // Sehr langes Wort: hart umbrechen.
      let chunk = ''
      for (const ch of word) {
        const trial = chunk + ch
        if (font.widthOfTextAtSize(trial, size) > maxWidth && chunk) {
          lines.push(chunk)
          chunk = ch
        } else {
          chunk = trial
        }
      }
      line = chunk
    }
    if (line) lines.push(line)
  }
  return lines
}

/** Erkannte Lücke in PDF-Punkten (Ursprung unten links, y = Text-Baseline). */
export interface PdfBlankRegion {
  pageIndex: number
  /** Dokumentweiter Index von oben nach unten, links nach rechts. */
  blankIndex: number
  x: number
  /** Baseline der umgebenden Zeile (pdf.js / PDF-User-Space). */
  y: number
  width: number
  height: number
  kind: 'underscore' | 'gap'
  /** Text links der Lücke (gekürzt, Lesereihenfolge). */
  leftText: string
  /** Text rechts der Lücke (gekürzt, Lesereihenfolge). */
  rightText: string
}

export type PlacementSource = 'geometry' | 'bbox' | 'heuristic'

interface ResolvedPlacement {
  pageIndex: number
  /** PDF-User-Space X (Ursprung unten links). */
  x: number
  /** PDF-Baseline-Y (Ursprung unten links). */
  baselineY: number
  boxWidth: number
  boxHeight: number
  fontSize: number
  text: string
  source: PlacementSource
  fieldType: SolutionFieldType
}

const MIN_GAP_PT = 24
const MAX_GAP_PAGE_FRACTION = 0.38
/** eng: nur echte Baseline-Gleichheit; verhindert, dass schräg liegende Overlays Zeilen mergen. */
const LINE_Y_TOLERANCE_FACTOR = 0.22

/** Füllmodus: echte Lücken vs. offene Aufgaben ohne Antwortplätze im Dokument. */
export type SolutionFillMode = 'lueckentext' | 'offen'

/** Typische Wörter unmittelbar vor einer Lücke in Deutsch-Lückentexten. */
const CLOZE_LEFT_TOKEN =
  /^(der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines|und|oder|mit|von|zu|im|am|zum|zur|ist|sind|wird|werden|hat|haben|nicht|kein|keine|als|bei|nach|vor|für|über|unter|beim|vom|sehr|auch|nur|noch|schon|mehr|weniger|ca|bzw)$/i

interface PdfTextRun {
  str: string
  x: number
  y: number
  width: number
  height: number
  xEnd: number
}

/**
 * Vision/Norm-Koordinaten (Ursprung oben links, y nach unten) → PDF-Baseline
 * (Ursprung unten links). `yNorm` bezieht sich auf die obere Kante der Lücke.
 */
export function topLeftNormToPdfBaseline(
  yNorm: number,
  pageHeight: number,
  fontSize: number,
  boxHeight?: number,
): number {
  const topY = pageHeight - clamp01(yNorm) * pageHeight
  const box = boxHeight && boxHeight > 0 ? boxHeight : fontSize * 1.2
  // Leicht unter die obere Kante setzen; Baseline ≈ oberer Rand − Schriftgröße.
  const baseline = topY - Math.min(fontSize, box * 0.85)
  return Math.min(pageHeight - 4, Math.max(4, baseline))
}

function fontSizeFromBoxHeight(boxHeight: number): number {
  return Math.min(14, Math.max(8, boxHeight * 0.85))
}

function fontSizeForField(boxHeight: number, fieldType: SolutionFieldType): number {
  if (fieldType === 'freitext') {
    // Mehrzeilig: kleinere Schrift, damit der Block lesbar bleibt.
    return Math.min(11, Math.max(7, boxHeight * 0.2))
  }
  return fontSizeFromBoxHeight(boxHeight)
}

/** Heuristik, wenn das Modell keinen fieldType liefert. */
export function inferAnswerFieldType(
  answer: SolutionAnswer,
  blank?: PdfBlankRegion | null,
  pageHeight?: number,
): SolutionFieldType {
  if (answer.fieldType === 'luecke' || answer.fieldType === 'freitext') return answer.fieldType
  const hNorm = answer.bbox?.h
  if (hNorm != null && hNorm >= 0.045) return 'freitext'
  if (blank && pageHeight && pageHeight > 0 && blank.height / pageHeight >= 0.045) {
    return 'freitext'
  }
  if (blank && blank.height >= 28) return 'freitext'
  const text = answer.answer ?? ''
  if (text.length > 90 || /\n/.test(text)) return 'freitext'
  return 'luecke'
}

/** PDF-Lücke (User-Space) → normierte bbox (Ursprung oben links). */
export function blankRegionToBBox(
  blank: PdfBlankRegion,
  pageWidth: number,
  pageHeight: number,
): SolutionBBox {
  const fontSize = fontSizeFromBoxHeight(blank.height)
  const topY = blank.y + Math.min(fontSize, blank.height * 0.85)
  return {
    x: clamp01(blank.x / pageWidth),
    y: clamp01(1 - topY / pageHeight),
    w: clamp01(Math.max(0.02, blank.width / pageWidth)),
    h: clamp01(Math.max(0.012, blank.height / pageHeight)),
  }
}

/**
 * Ergänzt fieldType und bbox aus erkannter Geometrie – für Persistenz und Nachbearbeitung.
 *
 * Wichtig: Bei zugeordneter Lücke überschreibt die PDF-Geometrie eine Vision-bbox.
 * Sonst zeigt der Browser-Editor andere Positionen als das gezeichnete Overlay-PDF
 * (PDF bevorzugt Geometrie, die Vorschau zeigte bisher die Vision-Koordinaten).
 */
export function enrichSolutionPlacements(
  solution: StructuredSolution,
  blanks: PdfBlankRegion[],
  pageSizes: Array<{ width: number; height: number }>,
): StructuredSolution {
  if (solution.answers.length === 0) return solution
  const answers = solution.answers.map((answer) => {
    const blank =
      typeof answer.blankIndex === 'number'
        ? blanks.find((b) => b.blankIndex === answer.blankIndex)
        : undefined
    const pageNumber = Math.min(
      Math.max(1, answer.page && answer.page > 0 ? Math.floor(answer.page) : (blank?.pageIndex ?? 0) + 1),
      Math.max(1, pageSizes.length),
    )
    const size = pageSizes[pageNumber - 1] ?? pageSizes[0]
    // Geometrie hat Vorrang – analog zu resolvePlacements ohne preferBBox.
    const bbox =
      blank && size
        ? blankRegionToBBox(blank, size.width, size.height)
        : (answer.bbox ?? null)
    const fieldType = inferAnswerFieldType(answer, blank, size?.height)
    return {
      ...answer,
      page: pageNumber,
      bbox,
      fieldType,
      leftContext: answer.leftContext ?? blank?.leftText ?? null,
      rightContext: answer.rightContext ?? blank?.rightText ?? null,
    }
  })
  return { ...solution, answers }
}

function sortAnswersForPlacement(answers: SolutionAnswer[]): SolutionAnswer[] {
  return [...answers].sort((a, b) => {
    const pageA = a.page && a.page > 0 ? a.page : 1
    const pageB = b.page && b.page > 0 ? b.page : 1
    if (pageA !== pageB) return pageA - pageB
    const blankA = typeof a.blankIndex === 'number' ? a.blankIndex : Number.MAX_SAFE_INTEGER
    const blankB = typeof b.blankIndex === 'number' ? b.blankIndex : Number.MAX_SAFE_INTEGER
    if (blankA !== blankB) return blankA - blankB
    return a.id.localeCompare(b.id, 'de')
  })
}

function groupRunsIntoLines(runs: PdfTextRun[]): PdfTextRun[][] {
  if (runs.length === 0) return []
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: PdfTextRun[][] = []
  for (const run of sorted) {
    const tol = Math.max(3, run.height * LINE_Y_TOLERANCE_FACTOR)
    const line = lines.find((candidate) => Math.abs(candidate[0]!.y - run.y) <= tol)
    if (line) line.push(run)
    else lines.push([run])
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x)
  // Oben → unten (PDF-y absteigend).
  lines.sort((a, b) => b[0]!.y - a[0]!.y)
  return lines
}

function estimateCharWidth(run: PdfTextRun): number {
  const chars = Math.max(1, run.str.length)
  return Math.max(3, run.width / chars)
}

function clipContext(text: string, side: 'left' | 'right', max = 56): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return side === 'left' ? normalized.slice(-max) : normalized.slice(0, max)
}

function pushBlank(
  into: Omit<PdfBlankRegion, 'blankIndex'>[],
  blank: Omit<PdfBlankRegion, 'blankIndex'>,
): void {
  if (blank.width < MIN_GAP_PT * 0.75 || blank.height < 4) return
  const normalized = {
    ...blank,
    leftText: clipContext(blank.leftText ?? '', 'left'),
    rightText: clipContext(blank.rightText ?? '', 'right'),
  }
  // Nahezu identische Treffer (Unterstrich + Gap) zusammenführen.
  const duplicate = into.find(
    (existing) =>
      existing.pageIndex === normalized.pageIndex &&
      Math.abs(existing.y - normalized.y) < 3 &&
      Math.abs(existing.x - normalized.x) < 8,
  )
  if (duplicate) {
    duplicate.width = Math.max(duplicate.width, normalized.width)
    duplicate.height = Math.max(duplicate.height, normalized.height)
    if (normalized.kind === 'underscore') duplicate.kind = 'underscore'
    if (normalized.leftText.length > duplicate.leftText.length) {
      duplicate.leftText = normalized.leftText
    }
    if (normalized.rightText.length > duplicate.rightText.length) {
      duplicate.rightText = normalized.rightText
    }
    return
  }
  into.push(normalized)
}

function detectUnderscoreBlanks(
  pageIndex: number,
  run: PdfTextRun,
  lineRuns: PdfTextRun[],
  into: Omit<PdfBlankRegion, 'blankIndex'>[],
): void {
  const pattern = /(?:_{3,}|\.{4,}|…{2,})/g
  let match: RegExpExecArray | null
  const runIndex = lineRuns.indexOf(run)
  const beforeRuns = runIndex >= 0 ? lineRuns.slice(0, runIndex) : []
  const afterRuns = runIndex >= 0 ? lineRuns.slice(runIndex + 1) : []
  while ((match = pattern.exec(run.str)) != null) {
    const start = match.index
    const len = match[0].length
    const charW = estimateCharWidth(run)
    const x = run.x + start * charW
    const width = Math.max(MIN_GAP_PT, len * charW)
    const leftText =
      beforeRuns.map((r) => r.str).join('') + run.str.slice(0, start)
    const rightText =
      run.str.slice(start + len) + afterRuns.map((r) => r.str).join('')
    pushBlank(into, {
      pageIndex,
      x,
      y: run.y,
      width,
      height: Math.max(10, run.height),
      kind: 'underscore',
      leftText,
      rightText,
    })
  }
}

function looksLikeSentenceFragment(text: string): boolean {
  const trimmed = text.trim()
  // Mindestens ein „Wort“ mit 3+ Buchstaben/Ziffern – filtert Icons, Seitenzahlen, einzelne Overlay-Wörter.
  return /[\p{L}\p{N}]{3,}/u.test(trimmed) && trimmed.length >= 3
}

function medianPositive(values: number[]): number {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!
}

/** Run besteht nur aus Lückenfüllern (Unterstriche/Punkte), oft je Zeichen ein eigener Run. */
function isBlankFillerRun(text: string): boolean {
  const trimmed = text.replace(/\s+/g, '')
  if (!trimmed) return false
  return /^[_.…·•]+$/.test(trimmed)
}

/** Links der Lücke endet typischerweise mit Artikel/Präposition oder kurzem Fragment. */
function looksLikeClozeLeft(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || /[.!?…]\s*$/.test(trimmed)) return false
  if (/[,;:–—\-]$/.test(trimmed)) return true
  const words = trimmed.split(/\s+/).filter(Boolean)
  const last = words[words.length - 1] ?? ''
  if (CLOZE_LEFT_TOKEN.test(last)) return true
  // Zahl vor Lücke („20.000 ___“) – typisch für Lückentexte.
  if (/^\d[\d.,]*$/.test(last)) return true
  // Kurzes linkes Fragment („Die“, „ist sie sehr“) – typisch für Lückentexte.
  if (trimmed.length <= 28) return true
  return last.length <= 5
}

/**
 * Prüft, ob eine Gap-Region wie eine echte Antwortlücke aussieht
 * (vs. Blocksatz-/Spaltenabstand in Fließtext).
 * Bewertet den rechten Rand des linken Kontexts (nicht den ganzen Zeilenanfang).
 */
export function looksLikeClozeGap(blank: Pick<PdfBlankRegion, 'kind' | 'leftText' | 'rightText' | 'width'>): boolean {
  if (blank.kind === 'underscore') return true
  const left = (blank.leftText ?? '').trim()
  const right = (blank.rightText ?? '').trim()
  if (!left || !right) return false
  // Abgeschlossener Satz links → Layout, keine Lücke.
  if (/[.!?…]\s*$/.test(left)) return false
  // Nummerierte Folgeaufgabe rechts → eher Spalten-/Absatzlayout.
  if (/^\d+[\.)]/.test(right)) return false

  const leftWords = left.split(/\s+/).filter(Boolean)
  const rightWords = right.split(/\s+/).filter(Boolean)
  const last = leftWords[leftWords.length - 1] ?? ''
  const leftTail = leftWords.slice(-3).join(' ')

  // Langer Fließtext links und rechts: nur bei starkem Cloze-Cue am linken Rand behalten.
  if (leftWords.length >= 6 && rightWords.length >= 6) {
    return (
      /^(der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines|sehr)$/i.test(last) ||
      /^\d[\d.,]*$/.test(last)
    )
  }

  return looksLikeClozeLeft(leftTail || left)
}

/**
 * Behält zuverlässige Lücken (Unterstriche + cloze-ähnliche Gaps).
 * Reine Layout-Abstände in Fließtext entfallen – verhindert „Lücken“ in offenen Aufgaben.
 */
export function filterReliableBlanks(blanks: PdfBlankRegion[]): PdfBlankRegion[] {
  const reliable = blanks.filter((blank) =>
    blank.kind === 'underscore' ? true : looksLikeClozeGap(blank),
  )
  return reliable.map((blank, blankIndex) => ({ ...blank, blankIndex }))
}

export function classifySolutionFillMode(blanks: PdfBlankRegion[]): SolutionFillMode {
  return blanks.length > 0 ? 'lueckentext' : 'offen'
}

/**
 * Erkennt Unterstrich-/Punktlücken, die Word/PDF oft auf mehrere Runs aufteilen
 * („_“+“_“+“_“ statt „___“ in einem Run).
 */
function detectSplitUnderscoreBlanksOnLine(
  pageIndex: number,
  line: PdfTextRun[],
  into: Omit<PdfBlankRegion, 'blankIndex'>[],
): void {
  const content = line.filter((run) => run.str.length > 0)
  if (content.length === 0) return

  let i = 0
  while (i < content.length) {
    if (!isBlankFillerRun(content[i]!.str) && !/(?:_{3,}|\.{4,}|…{2,})/.test(content[i]!.str)) {
      i += 1
      continue
    }

    // Sequenz aus Füller-Runs und/oder Runs mit Unterstrichmuster zusammenfassen.
    const start = i
    let end = i
    let filler = ''
    while (end < content.length) {
      const run = content[end]!
      if (isBlankFillerRun(run.str)) {
        filler += run.str.replace(/\s+/g, '')
        end += 1
        continue
      }
      const inner = run.str.match(/(?:_{3,}|\.{4,}|…{2,})/g)
      if (inner && run.str.replace(/[\s_.…·•]/g, '').length === 0) {
        filler += inner.join('')
        end += 1
        continue
      }
      break
    }

    // Einzelnes "_" ohne Nachbarn: kein Blank (zu schwach).
    if (filler.length < 3 && end === start + 1 && !/(?:_{3,}|\.{4,}|…{2,})/.test(content[start]!.str)) {
      i = end
      continue
    }
    if (filler.length < 3 && !/(?:_{3,}|\.{4,}|…{2,})/.test(content.slice(start, end).map((r) => r.str).join(''))) {
      i = Math.max(end, start + 1)
      continue
    }

    const first = content[start]!
    const last = content[end - 1]!
    const leftText = content
      .slice(0, start)
      .map((r) => r.str)
      .join('')
    const rightText = content
      .slice(end)
      .map((r) => r.str)
      .join('')
    const width = Math.max(MIN_GAP_PT, last.xEnd - first.x)
    const lineHeight = Math.max(...content.map((r) => r.height), 10)

    pushBlank(into, {
      pageIndex,
      x: first.x,
      y: first.y,
      width,
      height: lineHeight,
      kind: 'underscore',
      leftText,
      rightText,
    })
    i = end
  }
}

function detectGapBlanksOnLine(
  pageIndex: number,
  line: PdfTextRun[],
  pageWidth: number,
  pageHeight: number,
  commonLeft: number,
  into: Omit<PdfBlankRegion, 'blankIndex'>[],
  previousLineText = '',
): void {
  const content = line.filter((run) => run.str.trim().length > 0)
  if (content.length === 0) return

  const lineY = content[0]!.y
  // Kopf-/Fußzeilen erzeugen oft große Abstände (Titel ↔ Copyright), keine Lücken.
  if (lineY < pageHeight * 0.06 || lineY > pageHeight * 0.94) return

  const maxGap = pageWidth * MAX_GAP_PAGE_FRACTION
  const lineHeight = Math.max(...content.map((r) => r.height), 10)

  // Semantische Runs: Lückenfüller („___“) überspringen – Abstand Wort→Füller→Wort zählt als eine Lücke.
  const semantic: Array<{ run: PdfTextRun; index: number }> = []
  for (let i = 0; i < content.length; i++) {
    if (isBlankFillerRun(content[i]!.str)) continue
    semantic.push({ run: content[i]!, index: i })
  }

  // Blocksatz: Abstände zwischen semantischen Nachbarn (ohne Füller dazwischen).
  const interGaps: number[] = []
  for (let s = 0; s < semantic.length - 1; s++) {
    const left = semantic[s]!
    const right = semantic[s + 1]!
    // Nur direkte Nachbarn ohne Füller dazwischen für Median (Blocksatz-Wortabstand).
    if (right.index === left.index + 1) {
      interGaps.push(right.run.x - left.run.xEnd)
    }
  }
  const medianGap = medianPositive(interGaps)

  for (let s = 0; s < semantic.length - 1; s++) {
    const left = semantic[s]!
    const right = semantic[s + 1]!
    const gap = right.run.x - left.run.xEnd
    const hasFillerBetween = right.index > left.index + 1
    if (!hasFillerBetween && (gap < MIN_GAP_PT || gap > maxGap)) continue
    if (hasFillerBetween) {
      // Füller-Runs zwischen Wörtern = Unterstrich-Lücke; Breite der Füllerregion.
      const fillerFirst = content[left.index + 1]!
      const fillerLast = content[right.index - 1]!
      const fillerWidth = fillerLast.xEnd - fillerFirst.x
      if (fillerWidth < MIN_GAP_PT * 0.5 && gap < MIN_GAP_PT) continue
    } else if (gap > maxGap) {
      continue
    }

    const rightOk =
      looksLikeSentenceFragment(right.run.str) || /^[–—\-.,;:!?)]/.test(right.run.str.trim())
    if (!looksLikeSentenceFragment(left.run.str) || !rightOk) continue
    if (
      !hasFillerBetween &&
      left.run.str.trim().length < 8 &&
      right.run.str.trim().length < 8 &&
      gap > 120
    ) {
      continue
    }

    const leftJoined = content
      .slice(0, left.index + 1)
      .map((r) => r.str)
      .join('')
    const rightJoined = content
      .slice(right.index)
      .map((r) => r.str)
      .join('')

    // Mit Füller dazwischen immer cloze; sonst nur Ausreißer-Abstände (kein Blocksatz).
    const isOutlier =
      hasFillerBetween ||
      medianGap <= 0 ||
      semantic.length <= 3 ||
      gap >= Math.max(MIN_GAP_PT, medianGap * 1.8)
    if (!isOutlier) continue
    if (
      !hasFillerBetween &&
      !looksLikeClozeGap({ kind: 'gap', leftText: leftJoined, rightText: rightJoined, width: gap })
    ) {
      continue
    }

    const blankX = hasFillerBetween ? content[left.index + 1]!.x : left.run.xEnd + 1
    const blankWidth = hasFillerBetween
      ? Math.max(MIN_GAP_PT, content[right.index - 1]!.xEnd - content[left.index + 1]!.x)
      : gap - 2

    pushBlank(into, {
      pageIndex,
      x: blankX,
      y: left.run.y,
      width: blankWidth,
      height: lineHeight,
      kind: hasFillerBetween ? 'underscore' : 'gap',
      leftText: leftJoined,
      rightText: rightJoined,
    })
  }

  // Umgebrochene Lücke: Zeile beginnt eingerückt, typisch mit Satzzeichen nach der Lücke.
  const first = content[0]!
  const startGap = first.x - commonLeft
  const startsWithPunct = /^[.!?,;:]/.test(first.str.trim())
  const lonelyShort =
    content.length === 1 && first.str.trim().length <= 32 && !startsWithPunct
  const wrapLeft = previousLineText.trim()
  const wrapRight = content.map((r) => r.str).join('')
  if (
    !lonelyShort &&
    startGap >= MIN_GAP_PT &&
    startGap <= maxGap &&
    looksLikeSentenceFragment(first.str) &&
    (startsWithPunct || (content.length >= 2 && startGap >= MIN_GAP_PT * 1.5)) &&
    (startsWithPunct ||
      looksLikeClozeGap({
        kind: 'gap',
        leftText: wrapLeft || '…',
        rightText: wrapRight,
        width: startGap,
      }))
  ) {
    pushBlank(into, {
      pageIndex,
      x: commonLeft,
      y: first.y,
      width: startGap - 1,
      height: lineHeight,
      kind: 'gap',
      leftText: previousLineText,
      rightText: wrapRight,
    })
  }
}

/**
 * Findet Lücken über PDF-Textgeometrie: Unterstrich-/Punktmuster und
 * große horizontale Lücken zwischen Textläufen derselben Zeile.
 */
export async function detectPdfBlankRegions(source: Buffer): Promise<PdfBlankRegion[]> {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({
    data: new Uint8Array(source),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  })

  try {
    const document = await task.promise
    const raw: Omit<PdfBlankRegion, 'blankIndex'>[] = []

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const runs: PdfTextRun[] = []

      for (const item of content.items) {
        if (!('str' in item) || typeof item.str !== 'string') continue
        const transform = item.transform
        if (!transform || transform.length < 6) continue
        const x = transform[4] ?? 0
        const y = transform[5] ?? 0
        const height =
          Math.hypot(transform[2] ?? 0, transform[3] ?? 0) ||
          Math.hypot(transform[0] ?? 0, transform[1] ?? 0) ||
          12
        const width = typeof item.width === 'number' ? item.width : item.str.length * height * 0.5
        runs.push({
          str: item.str,
          x,
          y,
          width,
          height,
          xEnd: x + width,
        })
      }

      const lines = groupRunsIntoLines(runs)
      const leftEdges = lines
        .map((line) => line.find((r) => r.str.trim())?.x)
        .filter((x): x is number => typeof x === 'number')
      leftEdges.sort((a, b) => a - b)
      const commonLeft =
        leftEdges.length > 0 ? leftEdges[Math.floor(leftEdges.length * 0.2)]! : 50

      let previousLineText = ''
      for (const line of lines) {
        for (const run of line) {
          if (/(?:_{3,}|\.{4,}|…{2,})/.test(run.str)) {
            detectUnderscoreBlanks(pageNumber - 1, run, line, raw)
          }
        }
        // Unterstriche oft je Zeichen ein Run – vor Gap-Erkennung zusammenfassen.
        detectSplitUnderscoreBlanksOnLine(pageNumber - 1, line, raw)
        detectGapBlanksOnLine(
          pageNumber - 1,
          line,
          viewport.width,
          viewport.height,
          commonLeft,
          raw,
          previousLineText,
        )
        previousLineText = line
          .filter((r) => r.str.trim())
          .map((r) => r.str)
          .join('')
      }
      page.cleanup()
    }

    raw.sort((a, b) => {
      if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex
      if (Math.abs(a.y - b.y) > 3) return b.y - a.y
      return a.x - b.x
    })

    const indexed = raw.map((blank, blankIndex) => ({ ...blank, blankIndex }))
    // Layout-Abstände in Fließtext verwerfen – sonst werden offene Aufgaben wie Lückentexte behandelt.
    return filterReliableBlanks(indexed)
  } finally {
    await task.destroy()
  }
}

/** Kompakte Lückenliste für den Prompt (Index + linker/rechter Kontext). */
export function formatBlankInventory(blanks: PdfBlankRegion[]): string {
  if (blanks.length === 0) return ''
  return blanks
    .map((blank) => {
      const left = blank.leftText || '…'
      const right = blank.rightText || '…'
      return `${blank.blankIndex}: „${left} ___ ${right}“ (Seite ${blank.pageIndex + 1})`
    })
    .join('\n')
}

function normalizeContext(value: string): string {
  return value
    .toLowerCase()
    .replace(/[„“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenOverlapScore(a: string, b: string): number {
  const tokensA = normalizeContext(a)
    .split(/[^a-zäöüß0-9]+/i)
    .filter((t) => t.length >= 3)
  const tokensB = new Set(
    normalizeContext(b)
      .split(/[^a-zäöüß0-9]+/i)
      .filter((t) => t.length >= 3),
  )
  if (tokensA.length === 0 || tokensB.size === 0) return 0
  let hits = 0
  for (const token of tokensA) {
    if (tokensB.has(token)) hits += 1
  }
  return hits
}

/** Wie gut passen Modell-Kontexte / Label zur erkannten Lücke? */
export function scoreAnswerBlankMatch(
  answer: SolutionAnswer,
  blank: PdfBlankRegion,
): number {
  let score = 0
  const aLeft = normalizeContext(answer.leftContext ?? '')
  const aRight = normalizeContext(answer.rightContext ?? '')
  const bLeft = normalizeContext(blank.leftText)
  const bRight = normalizeContext(blank.rightText)

  if (aLeft && bLeft) {
    if (bLeft.endsWith(aLeft) || aLeft.endsWith(bLeft)) score += 4
    else if (bLeft.includes(aLeft) || aLeft.includes(bLeft.slice(-24))) score += 2
    score += Math.min(3, tokenOverlapScore(aLeft, bLeft))
  }
  if (aRight && bRight) {
    if (bRight.startsWith(aRight) || aRight.startsWith(bRight)) score += 4
    else if (bRight.includes(aRight) || aRight.includes(bRight.slice(0, 24))) score += 2
    score += Math.min(3, tokenOverlapScore(aRight, bRight))
  }

  // Label oft „Aufgabe …“ – schwaches Signal über Seitennummer.
  if (answer.page && answer.page === blank.pageIndex + 1) score += 0.25

  return score
}

/**
 * Ordnet KI-Antworten den geometrisch erkannten Lücken zu.
 * Bevorzugt Kontext-Match, dann blankIndex, dann Dokumentreihenfolge.
 */
export function alignAnswersToBlanks(
  solution: StructuredSolution,
  blanks: PdfBlankRegion[],
): StructuredSolution {
  if (blanks.length === 0 || solution.answers.length === 0) return solution

  const used = new Set<number>()
  const aligned: SolutionAnswer[] = []
  const pending = [...solution.answers]

  const take = (answer: SolutionAnswer, blankIndex: number) => {
    const blank = blanks.find((b) => b.blankIndex === blankIndex)
    used.add(blankIndex)
    aligned.push({
      ...answer,
      blankIndex,
      page: answer.page && answer.page > 0 ? answer.page : (blank?.pageIndex ?? 0) + 1,
      leftContext: answer.leftContext ?? blank?.leftText ?? null,
      rightContext: answer.rightContext ?? blank?.rightText ?? null,
    })
  }

  // 1) Starke Kontext-Treffer (auch wenn blankIndex falsch/vertauscht ist).
  const contextAssigned = new Set<SolutionAnswer>()
  for (const answer of pending) {
    if (!answer.leftContext && !answer.rightContext) continue
    let best: { blankIndex: number; score: number } | null = null
    for (const blank of blanks) {
      if (used.has(blank.blankIndex)) continue
      const score = scoreAnswerBlankMatch(answer, blank)
      if (score < 3) continue
      if (!best || score > best.score) best = { blankIndex: blank.blankIndex, score }
    }
    if (best) {
      take(answer, best.blankIndex)
      contextAssigned.add(answer)
    }
  }
  const afterContext = pending.filter((a) => !contextAssigned.has(a))

  // 2) Modell-blankIndex, sofern gültig und frei.
  const indexAssigned = new Set<SolutionAnswer>()
  for (const answer of afterContext) {
    const idx = answer.blankIndex
    if (typeof idx !== 'number' || idx < 0 || idx >= blanks.length || used.has(idx)) {
      continue
    }
    take(answer, idx)
    indexAssigned.add(answer)
  }
  const afterIndex = afterContext.filter((a) => !indexAssigned.has(a))

  // 3) Rest in Dokumentreihenfolge auf freie Lücken.
  let cursor = 0
  for (const answer of afterIndex) {
    while (cursor < blanks.length && used.has(cursor)) cursor += 1
    if (cursor >= blanks.length) {
      aligned.push(answer)
      continue
    }
    take(answer, cursor)
    cursor += 1
  }

  aligned.sort((a, b) => (a.blankIndex ?? 999) - (b.blankIndex ?? 999))
  return { ...solution, answers: aligned }
}

function placementFromBlank(
  blank: PdfBlankRegion,
  text: string,
  fieldType: SolutionFieldType,
): ResolvedPlacement {
  const boxHeight =
    fieldType === 'freitext' ? Math.max(blank.height, 36) : blank.height
  const fontSize = fontSizeForField(boxHeight, fieldType)
  return {
    pageIndex: blank.pageIndex,
    x: blank.x + 1,
    baselineY: blank.y,
    boxWidth: Math.max(24, blank.width - 2),
    boxHeight,
    fontSize,
    text,
    source: 'geometry',
    fieldType,
  }
}

function placementFromBBox(
  pageIndex: number,
  pageWidth: number,
  pageHeight: number,
  bbox: SolutionBBox,
  text: string,
  fieldType: SolutionFieldType,
): ResolvedPlacement {
  const xNorm = clamp01(bbox.x)
  const yNorm = clamp01(bbox.y)
  const defaultH = fieldType === 'freitext' ? 0.08 : 0.028
  const defaultW = fieldType === 'freitext' ? 0.5 : 0.35
  const wNorm = bbox.w && bbox.w > 0.02 ? clamp01(bbox.w) : defaultW
  const hNorm = bbox.h && bbox.h > 0.01 ? clamp01(bbox.h) : defaultH
  const boxWidth = Math.max(24, wNorm * pageWidth)
  const boxHeight = Math.max(fieldType === 'freitext' ? 28 : 10, hNorm * pageHeight)
  const fontSize = fontSizeForField(boxHeight, fieldType)
  const x = Math.min(Math.max(8, xNorm * pageWidth), pageWidth - 16)
  const baselineY = topLeftNormToPdfBaseline(yNorm, pageHeight, fontSize, boxHeight)
  return {
    pageIndex,
    x,
    baselineY,
    boxWidth,
    boxHeight,
    fontSize,
    text,
    source: 'bbox',
    fieldType,
  }
}

function placementHeuristic(
  pageIndex: number,
  pageWidth: number,
  pageHeight: number,
  slot: number,
  text: string,
  fieldType: SolutionFieldType,
): ResolvedPlacement {
  const yNorm = Math.min(0.88, clamp01(0.12 + slot * 0.07))
  const boxWidth = pageWidth * (fieldType === 'freitext' ? 0.55 : 0.42)
  const boxHeight = pageHeight * (fieldType === 'freitext' ? 0.08 : 0.028)
  const fontSize = fontSizeForField(boxHeight, fieldType)
  return {
    pageIndex,
    x: pageWidth * 0.48,
    baselineY: topLeftNormToPdfBaseline(yNorm, pageHeight, fontSize, boxHeight),
    boxWidth,
    boxHeight,
    fontSize,
    text,
    source: 'heuristic',
    fieldType,
  }
}

export interface OverlayOptions {
  /**
   * Gespeicherte bbox der Antworten bevorzugen (Nachbearbeitung durch Autoren).
   * Standard: Geometrie der Lücken zuerst.
   */
  preferBBox?: boolean
}

function resolvePlacements(
  solution: StructuredSolution,
  pageSizes: Array<{ width: number; height: number }>,
  blanks: PdfBlankRegion[],
  options: OverlayOptions = {},
): ResolvedPlacement[] {
  if (pageSizes.length === 0) return []

  const sorted = sortAnswersForPlacement(solution.answers)
  const usedBlankIndexes = new Set<number>()
  const perPageCursor = new Map<number, number>()
  const placements: ResolvedPlacement[] = []
  let sequentialBlank = 0
  const preferBBox = Boolean(options.preferBBox)

  for (const answer of sorted) {
    const text = sanitizePdfText(answer.answer)
    if (!text) continue

    const pageNumber = Math.min(
      pageSizes.length,
      Math.max(1, answer.page && answer.page > 0 ? Math.floor(answer.page) : 1),
    )
    const pageIndex = pageNumber - 1
    const size = pageSizes[pageIndex] ?? pageSizes[0]!
    const cursor = perPageCursor.get(pageIndex) ?? 0
    perPageCursor.set(pageIndex, cursor + 1)

    let blank: PdfBlankRegion | undefined
    if (typeof answer.blankIndex === 'number' && answer.blankIndex >= 0) {
      blank = blanks.find((b) => b.blankIndex === answer.blankIndex)
    }
    const fieldType = inferAnswerFieldType(answer, blank, size.height)

    // Nachbearbeitung: explizite bbox der Autoren hat Vorrang.
    if (preferBBox && answer.bbox) {
      placements.push(
        placementFromBBox(pageIndex, size.width, size.height, answer.bbox, text, fieldType),
      )
      if (blank) usedBlankIndexes.add(blank.blankIndex)
      continue
    }

    // 1) PDF-Geometrie (zuverlässiger als Vision-bbox bei getippten Lückentexten).
    // Freitext nicht in Gap-„Lücken“ im Fließtext legen – das sind oft Layout-Abstände.
    const canUseGeometry = (candidate: PdfBlankRegion | undefined): candidate is PdfBlankRegion =>
      Boolean(
        candidate &&
          !usedBlankIndexes.has(candidate.blankIndex) &&
          !(fieldType === 'freitext' && candidate.kind === 'gap'),
      )

    if (!canUseGeometry(blank) && blanks.length > 0 && fieldType !== 'freitext') {
      while (sequentialBlank < blanks.length && usedBlankIndexes.has(sequentialBlank)) {
        sequentialBlank += 1
      }
      blank = blanks[sequentialBlank]
    }

    if (canUseGeometry(blank)) {
      usedBlankIndexes.add(blank.blankIndex)
      if (blank.blankIndex === sequentialBlank) sequentialBlank += 1
      placements.push(placementFromBlank(blank, text, fieldType))
      continue
    }

    // 2) Vision-bbox (normiert, Ursprung oben links → PDF-Y spiegeln).
    if (answer.bbox) {
      placements.push(
        placementFromBBox(pageIndex, size.width, size.height, answer.bbox, text, fieldType),
      )
      continue
    }

    // 3) Grobe Heuristik.
    const slot =
      typeof answer.blankIndex === 'number' && answer.blankIndex >= 0
        ? answer.blankIndex
        : cursor
    placements.push(
      placementHeuristic(pageIndex, size.width, size.height, slot, text, fieldType),
    )
  }

  return placements
}

function drawPlacement(
  page: PDFPage,
  font: PDFFont,
  placement: ResolvedPlacement,
): void {
  const { width, height } = page.getSize()
  const boxWidth = Math.max(24, placement.boxWidth)
  const fontSize = placement.fontSize
  const lines = wrapTextToWidth(placement.text, font, fontSize, boxWidth)
  if (lines.length === 0) return

  const lineHeight = fontSize + (placement.fieldType === 'freitext' ? 3 : 2)
  let baseline = Math.min(height - 4, Math.max(4, placement.baselineY))
  const fitted = Math.max(1, Math.floor(placement.boxHeight / lineHeight) || 1)
  const fallback =
    placement.fieldType === 'freitext' ? 8 : placement.source === 'bbox' ? 3 : 2
  const visible = lines.slice(0, Math.max(fitted, fallback))
  const x = Math.min(Math.max(8, placement.x), width - 16)

  for (const line of visible) {
    if (baseline < 4) break
    try {
      page.drawText(line, {
        x,
        y: baseline,
        size: fontSize,
        font,
        color: SOLUTION_INK,
        maxWidth: boxWidth,
      })
    } catch (error) {
      log.debug('PDF-Text Overlay fehlgeschlagen', { error, line: line.slice(0, 40) })
    }
    baseline -= lineHeight
  }
}

/**
 * Zeichnet Lösungstexte als Overlay auf eine Kopie des Original-PDFs.
 * Bevorzugt erkannte Lücken-Geometrie; Vision-bbox nur als Fallback.
 */
export async function overlayPdfAnswers(
  source: Buffer,
  solution: StructuredSolution,
  options: OverlayOptions = {},
): Promise<{
  buffer: Buffer
  overlays: number
  usedBBox: number
  usedGeometry: number
}> {
  const pdf = await PDFDocument.load(source, { ignoreEncryption: true })
  const pages = pdf.getPages()
  if (pages.length === 0) {
    throw new Error('PDF enthält keine Seiten.')
  }

  let blanks: PdfBlankRegion[] = []
  // Auch bei preferBBox erkennen: Antworten ohne gespeicherte bbox brauchen Fallback.
  try {
    blanks = await detectPdfBlankRegions(source)
  } catch (error) {
    log.warn('PDF-Lückenerkennung fehlgeschlagen – Fallback auf bbox/Heuristik', error)
  }

  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const pageSizes = pages.map((page) => page.getSize())
  const placements = resolvePlacements(solution, pageSizes, blanks, options)
  let overlays = 0
  let usedBBox = 0
  let usedGeometry = 0

  for (const placement of placements) {
    const page = pages[placement.pageIndex]
    if (!page) continue
    drawPlacement(page, font, placement)
    overlays += 1
    if (placement.source === 'bbox') usedBBox += 1
    if (placement.source === 'geometry') usedGeometry += 1
  }

  log.debug('PDF-Overlay Platzierung', {
    overlays,
    usedGeometry,
    usedBBox,
    detectedBlanks: blanks.length,
  })

  return {
    buffer: Buffer.from(await pdf.save()),
    overlays,
    usedBBox,
    usedGeometry,
  }
}

/**
 * Erzeugt ein separates, blankes PDF mit Aufgabennummer und Musterlösung.
 * Für offene Aufgaben ohne Lücken/Antwortfelder im Originalmaterial.
 */
export async function buildAnswerListPdf(
  title: string,
  solution: StructuredSolution,
  options: { notice?: string } = {},
): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const pageWidth = 595.28
  const pageHeight = 841.89
  const margin = 56
  const maxWidth = pageWidth - margin * 2
  let page = pdf.addPage([pageWidth, pageHeight])
  let y = pageHeight - margin

  const ensureSpace = (needed: number) => {
    if (y - needed >= margin) return
    page = pdf.addPage([pageWidth, pageHeight])
    y = pageHeight - margin
  }

  const drawWrapped = (text: string, size: number, bold = false, color = rgb(0.12, 0.14, 0.18)) => {
    const active = bold ? fontBold : font
    const safe = sanitizePdfText(text)
    const paragraphs = safe.split(/\n+/).filter((p) => p.trim().length > 0)
    if (paragraphs.length === 0) return

    for (const paragraph of paragraphs) {
      const words = paragraph.split(/\s+/).filter(Boolean)
      let line = ''
      const flush = () => {
        if (!line) return
        ensureSpace(size + 4)
        page.drawText(line, { x: margin, y, size, font: active, color })
        y -= size + 4
        line = ''
      }
      for (const word of words) {
        const next = line ? `${line} ${word}` : word
        if (active.widthOfTextAtSize(next, size) > maxWidth) {
          flush()
          line = word
        } else {
          line = next
        }
      }
      flush()
    }
  }

  drawWrapped(title, 16, true)
  y -= 6
  if (options.notice) {
    drawWrapped(options.notice, 9, false, rgb(0.35, 0.38, 0.42))
    y -= 10
  }
  if (solution.summary?.trim()) {
    drawWrapped(solution.summary.trim(), 11)
    y -= 14
  }

  for (const answer of solution.answers) {
    ensureSpace(40)
    drawWrapped(answer.label || 'Aufgabe', 12, true, SOLUTION_INK)
    y -= 2
    drawWrapped(answer.answer, 11)
    y -= 12
  }

  if (solution.notesForTeacher?.trim()) {
    ensureSpace(36)
    drawWrapped('Hinweise für die Lehrkraft', 12, true)
    drawWrapped(solution.notesForTeacher.trim(), 11)
    y -= 10
  }
  if (solution.uncertainties?.trim()) {
    ensureSpace(36)
    drawWrapped('Unklarheiten', 12, true)
    drawWrapped(solution.uncertainties.trim(), 11)
  }

  return Buffer.from(await pdf.save())
}

export function solutionFileName(sourceName: string | null | undefined, extension: string): string {
  const base = (sourceName ?? 'Material').replace(/\.[^.]+$/, '')
  return `Musterloesung-${base}.${extension}`
}
