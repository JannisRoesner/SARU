import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { createLogger } from '../../utils/logger'
import { extractJsonObject } from '../../utils/json-parse'
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
  /** DOCX: Ziel-ID (txbx-0, shape-1, tc-0:1, …). */
  targetId?: string | null
}

export type DiagramMark =
  | { kind: 'label'; text: string; targetId: string }
  | {
      kind: 'chromosome'
      form: 'two_chromatid' | 'one_chromatid'
      count: number
      targetId: string
    }
  | { kind: 'arrow_label'; text: string; targetId: string }

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
  /** Strukturierte Diagramm-Markierungen (DOCX diagram_completion). */
  diagramMarks?: DiagramMark[] | null
}

export type FillStrategy =
  | 'docx_inplace'
  | 'docx_appended'
  /** In-place-Befüllung plus Anhang für offene Teilaufgaben. */
  | 'docx_mixed'
  | 'pdf_acroform'
  | 'pdf_overlay'
  /** Separates blankes PDF mit Aufgabennummer + Lösung (offene Aufgaben). */
  | 'pdf_separate'
  /** Originalseiten mit Overlay + angehängte Lösungsseiten für offene Aufgaben. */
  | 'pdf_hybrid'
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

function parseDiagramMarks(raw: unknown): DiagramMark[] {
  if (!Array.isArray(raw)) return []
  const out: DiagramMark[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const kind = String(row.kind ?? '')
    const targetId = String(row.targetId ?? '').trim()
    if (!targetId) continue
    if (kind === 'label' || kind === 'arrow_label') {
      const text = String(row.text ?? '').trim()
      if (!text) continue
      out.push({ kind, text, targetId })
    } else if (kind === 'chromosome') {
      const form =
        row.form === 'one_chromatid' ? 'one_chromatid' : 'two_chromatid'
      const count = Number(row.count)
      out.push({
        kind: 'chromosome',
        form,
        count: Number.isFinite(count) && count > 0 ? Math.floor(count) : 1,
        targetId,
      })
    }
  }
  return out
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

function mapAnswerEntry(entry: unknown, index: number): SolutionAnswer | null {
  if (!entry || typeof entry !== 'object') return null
  const row = entry as Record<string, unknown>
  const answer = String(row.answer ?? row.value ?? '').trim()
  if (!answer) return null
  // Roh-JSON darf nie als Lückentext landen (typisch nach fehlgeschlagenem Parse).
  if (answer.startsWith('{') && /"answers"\s*:/.test(answer)) return null

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
  const targetIdRaw = String(row.targetId ?? row.target ?? '').trim()
  return {
    id: String(row.id ?? index + 1),
    label: String(row.label ?? row.task ?? `Aufgabe ${index + 1}`),
    answer,
    page: typeof row.page === 'number' ? row.page : null,
    blankIndex: typeof row.blankIndex === 'number' ? row.blankIndex : null,
    leftContext: leftContext || null,
    rightContext: rightContext || null,
    bbox: flatBBox,
    fieldType,
    targetId: targetIdRaw || null,
  }
}

function structuredSolutionFromParsed(
  parsed: Record<string, unknown>,
  fallbackText: string,
): StructuredSolution {
  const answersRaw = Array.isArray(parsed.answers) ? parsed.answers : []
  const fieldsRaw = Array.isArray(parsed.formFields) ? parsed.formFields : []

  const answers: SolutionAnswer[] = []
  for (const [index, entry] of answersRaw.entries()) {
    const mapped = mapAnswerEntry(entry, index)
    if (mapped) answers.push(mapped)
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

  const diagramMarks = parseDiagramMarks(parsed.diagramMarks)

  if (answers.length === 0 && formFields.length === 0 && diagramMarks.length === 0) {
    const fallback = String(parsed.summary ?? parsed.text ?? fallbackText).trim()
    // Kein JSON-Dump als einzige „Antwort“ – sonst landet er in der ersten Lücke.
    const safeFallback =
      fallback.startsWith('{') && /"answers"\s*:/.test(fallback) ? '' : fallback
    return {
      summary: 'Automatisch erstellte Musterlösung.',
      answers: safeFallback ? [{ id: '1', label: 'Lösung', answer: safeFallback }] : [],
      formFields: [],
    }
  }

  return {
    summary: String(parsed.summary ?? 'Automatisch erstellte Musterlösung.').trim(),
    answers,
    formFields,
    notesForTeacher: parsed.notesForTeacher ? String(parsed.notesForTeacher) : null,
    uncertainties: parsed.uncertainties ? String(parsed.uncertainties) : null,
    diagramMarks: diagramMarks.length > 0 ? diagramMarks : null,
  }
}

/**
 * Rekonstruiert eine abgeschnittene Lösungs-JSON (häufig bei vielen Lücken /
 * kleinem max_tokens): vollständige Answer-Objekte aus dem answers-Array bergen.
 */
export function recoverTruncatedSolutionJson(text: string): Record<string, unknown> | null {
  const answersKey = text.match(/"answers"\s*:\s*\[/)
  if (!answersKey || answersKey.index == null) return null

  const arrayBodyStart = answersKey.index + answersKey[0].length
  const answers: unknown[] = []
  let i = arrayBodyStart
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i]!)) i += 1
    if (i >= text.length || text[i] === ']') break
    if (text[i] !== '{') break

    let depth = 0
    let inString = false
    let escaped = false
    const start = i
    for (; i < text.length; i++) {
      const char = text[i]!
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') {
        inString = true
        continue
      }
      if (char === '{') depth += 1
      else if (char === '}') {
        depth -= 1
        if (depth === 0) {
          i += 1
          const slice = text.slice(start, i)
          try {
            answers.push(JSON.parse(slice))
          } catch {
            // Unvollständiges Objekt am Truncation-Punkt – abbrechen.
            i = text.length
          }
          break
        }
      }
    }
    if (depth !== 0) break
  }

  if (answers.length === 0) return null

  const summaryMatch = text.match(/"summary"\s*:\s*"((?:\\.|[^"\\])*)"/)
  let summary = 'Automatisch erstellte Musterlösung (teilweise rekonstruiert).'
  if (summaryMatch?.[1]) {
    try {
      summary = JSON.parse(`"${summaryMatch[1]}"`) as string
    } catch {
      summary = summaryMatch[1]
    }
  }

  const diagramKey = text.match(/"diagramMarks"\s*:\s*\[/)
  let diagramMarks: unknown[] | undefined
  if (diagramKey && diagramKey.index != null) {
    const marks: unknown[] = []
    let j = diagramKey.index + diagramKey[0].length
    while (j < text.length) {
      while (j < text.length && /[\s,]/.test(text[j]!)) j += 1
      if (j >= text.length || text[j] === ']') break
      if (text[j] !== '{') break
      let depth = 0
      let inString = false
      let escaped = false
      const start = j
      for (; j < text.length; j++) {
        const char = text[j]!
        if (inString) {
          if (escaped) escaped = false
          else if (char === '\\') escaped = true
          else if (char === '"') inString = false
          continue
        }
        if (char === '"') {
          inString = true
          continue
        }
        if (char === '{') depth += 1
        else if (char === '}') {
          depth -= 1
          if (depth === 0) {
            j += 1
            try {
              marks.push(JSON.parse(text.slice(start, j)))
            } catch {
              j = text.length
            }
            break
          }
        }
      }
      if (depth !== 0) break
    }
    if (marks.length > 0) diagramMarks = marks
  }

  return {
    summary,
    answers,
    formFields: [],
    ...(diagramMarks ? { diagramMarks } : {}),
  }
}

/**
 * Prüft streng, ob die Modellantwort ein vollständig geschlossenes JSON-Objekt
 * enthält. Tolerante Teilrekonstruktionen zählen absichtlich nicht als vollständig.
 */
export function isCompleteStructuredSolutionJson(raw: string): boolean {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1]?.trim() ?? trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return false
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1))
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed))
  } catch {
    return false
  }
}

/** Extrahiert strukturierte Lösung aus LLM-Text (JSON oder Markdown-Fence). */
export function parseStructuredSolution(raw: string): StructuredSolution {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1]?.trim() ?? trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0) {
    return {
      summary: 'Automatisch erstellte Musterlösung (Freitext).',
      answers: [{ id: '1', label: 'Lösung', answer: trimmed }],
      formFields: [],
    }
  }

  const slice =
    end > start ? candidate.slice(start, end + 1) : candidate.slice(start)

  try {
    const parsed = JSON.parse(slice) as Record<string, unknown>
    return structuredSolutionFromParsed(parsed, trimmed)
  } catch (error) {
    const extracted = extractJsonObject(candidate)
    if (extracted) {
      const recovered = structuredSolutionFromParsed(extracted, trimmed)
      if (recovered.answers.length > 0 || recovered.formFields.length > 0) {
        log.info('Strukturierte Lösung über toleranten JSON-Parser gelesen', {
          answers: recovered.answers.length,
        })
        return recovered
      }
    }

    const truncated = recoverTruncatedSolutionJson(candidate.slice(start))
    if (truncated) {
      const recovered = structuredSolutionFromParsed(truncated, trimmed)
      if (recovered.answers.length > 0 || (recovered.diagramMarks?.length ?? 0) > 0) {
        log.warn('Strukturierte Lösung aus abgeschnittenem JSON rekonstruiert', {
          answers: recovered.answers.length,
          diagramMarks: recovered.diagramMarks?.length ?? 0,
          parseError: error instanceof Error ? error.message : String(error),
        })
        return recovered
      }
    }

    log.warn('Strukturierte Lösung konnte nicht geparst werden – Freitext-Fallback', error)
    // JSON-ähnlichen Rohtext nicht als Lückenfüllung verwenden.
    if (trimmed.includes('"answers"') && trimmed.includes('{')) {
      return {
        summary: 'Automatisch erstellte Musterlösung (Freitext).',
        answers: [],
        formFields: [],
      }
    }
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
  /** underscore = ___/…; underline = unterstrichene Leerzeichen (Word-Formatierung). */
  kind?: 'underscore' | 'underline'
}

interface DocxRunInfo {
  xmlStart: number
  xmlEnd: number
  text: string
  underlined: boolean
  plainStart: number
}

function orderedAnswerTexts(solution: StructuredSolution): string[] {
  const byBlank = [...solution.answers]
    .filter((a) => typeof a.blankIndex === 'number')
    .sort((a, b) => (a.blankIndex ?? 0) - (b.blankIndex ?? 0))
    .map((a) => a.answer)
  if (byBlank.length) return byBlank
  return solution.answers.map((a) => a.answer)
}

function decodeXmlText(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

/** Sammelt Runs eines Absatzes inkl. Unterstreichungs-Flag. */
function collectDocxRuns(paragraphXml: string): DocxRunInfo[] {
  const runs: DocxRunInfo[] = []
  const re = /<w:r\b[\s\S]*?<\/w:r>/g
  let match: RegExpExecArray | null
  let plainStart = 0
  while ((match = re.exec(paragraphXml)) != null) {
    const full = match[0]
    const underlined = /<w:u[\s/>]/.test(full)
    const text = [...full.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((t) => decodeXmlText(t[1] ?? ''))
      .join('')
    runs.push({
      xmlStart: match.index,
      xmlEnd: match.index + full.length,
      text,
      underlined,
      plainStart,
    })
    plainStart += text.length
  }
  return runs
}

/** Nächster Run mit sichtbarem Wortinhalt (nicht nur Spaces/Unterstriche). */
function nearestContentRun(
  runs: DocxRunInfo[],
  fromIndex: number,
  direction: -1 | 1,
): DocxRunInfo | null {
  let i = fromIndex
  while (i >= 0 && i < runs.length) {
    const run = runs[i]!
    if (/\S/.test(run.text) && !/^[\s\u00a0_]+$/.test(run.text)) return run
    i += direction
  }
  return null
}

/**
 * Findet Lücken aus unterstrichenen Leerzeichen (typisch in Word-Arbeitsblättern
 * statt „___“-Zeichen). Aufeinanderfolgende unterstrichene Space-Runs werden
 * zu einer Lücke zusammengeführt.
 *
 * Wichtig: Wenn links und rechts bereits unterstrichene Wörter stehen (häufig
 * bei durchgängig unterstrichenen Absätzen / Lehrerfassungen mit eingetragenen
 * Antworten), sind die Space-Läufe nur Abstände – keine echten Lücken.
 */
function findUnderlineBlankRanges(
  runs: DocxRunInfo[],
): Array<{ start: number; end: number }> {
  const hasPlainContentWord = runs.some(
    (run) =>
      !run.underlined && /\S/.test(run.text) && !/^[\s\u00a0_]+$/.test(run.text),
  )
  // Durchgängig unterstrichener Absatz (Lehrerfassung mit eingetragenen Wörtern):
  // Space-Läufe sind Abstände, keine auszufüllenden Lücken.
  if (!hasPlainContentWord) return []

  const ranges: Array<{ start: number; end: number }> = []
  let i = 0
  while (i < runs.length) {
    const run = runs[i]!
    const isBlankRun = run.underlined && /^[\s\u00a0_]+$/.test(run.text) && run.text.length > 0
    if (!isBlankRun) {
      i += 1
      continue
    }
    const start = run.plainStart
    let end = run.plainStart + run.text.length
    let j = i + 1
    while (j < runs.length) {
      const next = runs[j]!
      if (next.underlined && /^[\s\u00a0_]+$/.test(next.text) && next.text.length > 0) {
        end = next.plainStart + next.text.length
        j += 1
      } else {
        break
      }
    }
    // Mindestens 3 Zeichen Breite – analog zu _{3,}
    if (end - start >= 3) {
      const left = nearestContentRun(runs, i - 1, -1)
      const right = nearestContentRun(runs, j, 1)
      // Abstand zwischen zwei bereits unterstrichenen Antwortwörtern → kein Blank.
      const sandwichedBetweenUnderlinedWords = Boolean(
        left?.underlined && right?.underlined,
      )
      // „Wort ___ ,“ / „Wort ___ .“ sind Abstände vor Satzzeichen, keine Lücken.
      const beforePunctuation = Boolean(right && /^[,.;:!?]/.test(right.text.trimStart()))
      if (!sandwichedBetweenUnderlinedWords && !beforePunctuation) {
        ranges.push({ start, end })
      }
    }
    i = j
  }
  return ranges
}

/** Mappt DOCX-Textlücken auf die Align-Schnittstelle von PDF-Lücken. */
export function textBlanksAsAlignable(blanks: TextBlankInfo[]): PdfBlankRegion[] {
  return blanks.map((blank) => ({
    pageIndex: 0,
    blankIndex: blank.blankIndex,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    kind: 'underscore' as const,
    leftText: blank.leftText,
    rightText: blank.rightText,
  }))
}

/**
 * Findet Unterstrich-/Punktlücken und unterstrichene Leerzeichen-Lücken in
 * DOCX-document.xml (auch über Run-Grenzen und in Tabellenzellen).
 */
export function detectDocxBlanks(source: Buffer): TextBlankInfo[] {
  const files = unzipSync(new Uint8Array(source))
  const docEntry = files['word/document.xml']
  if (!docEntry) return []
  const xml = strFromU8(docEntry)
  const blanks: TextBlankInfo[] = []

  // Absatzweise: Zeichenmuster (___) und Formatierungs-Lücken (unterstrichene Spaces).
  const paraRe = /<w:p\b[\s\S]*?<\/w:p>/g
  let paraMatch: RegExpExecArray | null
  while ((paraMatch = paraRe.exec(xml)) != null) {
    const paragraphXml = paraMatch[0]
    const runs = collectDocxRuns(paragraphXml)
    if (runs.length === 0) continue
    const plain = runs.map((r) => r.text).join('')

    const charRanges: Array<{ start: number; end: number; kind: 'underscore' }> = []
    const pattern = new RegExp(BLANK_PATTERN.source, 'g')
    let match: RegExpExecArray | null
    while ((match = pattern.exec(plain)) != null) {
      charRanges.push({
        start: match.index,
        end: match.index + match[0].length,
        kind: 'underscore',
      })
    }

    const underlineRanges = findUnderlineBlankRanges(runs).map((r) => ({
      ...r,
      kind: 'underline' as const,
    }))

    // Zeichenlücken haben Vorrang; Formatierungs-Lücken nur, wenn sie nicht
    // mit einer Zeichenlücke überlappen.
    const ranges = [
      ...charRanges,
      ...underlineRanges.filter(
        (u) => !charRanges.some((c) => c.start < u.end && c.end > u.start),
      ),
    ].sort((a, b) => a.start - b.start)

    for (const range of ranges) {
      blanks.push({
        blankIndex: blanks.length,
        leftText: plain.slice(Math.max(0, range.start - 56), range.start).replace(/\s+/g, ' ').trim(),
        rightText: plain.slice(range.end, range.end + 56).replace(/\s+/g, ' ').trim(),
        kind: range.kind,
      })
    }
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
 * Füllt Lücken in einem Absatz. Bevorzugt minimale Run-Ersetzung:
 * Runs außerhalb der Lücke bleiben inkl. rPr erhalten; nur Lücken-Runs
 * werden durch blaue Antwort-Runs ersetzt. Fallback: Absatz neu aufbauen.
 */
function fillBlanksInParagraphXml(
  paragraphXml: string,
  answers: string[],
  cursor: { index: number },
): { xml: string; replaced: number } {
  const runInfos = collectDocxRuns(paragraphXml)
  if (runInfos.length === 0) return { xml: paragraphXml, replaced: 0 }

  const plain = runInfos.map((r) => r.text).join('')

  const charRanges: Array<{ start: number; end: number }> = []
  const pattern = new RegExp(BLANK_PATTERN.source, 'g')
  let match: RegExpExecArray | null
  while ((match = pattern.exec(plain)) != null) {
    charRanges.push({ start: match.index, end: match.index + match[0].length })
  }
  const underlineRanges = findUnderlineBlankRanges(runInfos).filter(
    (u) => !charRanges.some((c) => c.start < u.end && c.end > u.start),
  )
  const ranges = [...charRanges, ...underlineRanges].sort((a, b) => a.start - b.start)
  if (ranges.length === 0) return { xml: paragraphXml, replaced: 0 }

  const blanks: Array<{ start: number; end: number; value: string | null }> = []
  for (const range of ranges) {
    const value = answers[cursor.index] ?? null
    if (value != null) cursor.index += 1
    blanks.push({ start: range.start, end: range.end, value })
  }
  const replaced = blanks.filter((b) => b.value != null).length
  if (replaced === 0) return { xml: paragraphXml, replaced: 0 }

  // Minimale Ersetzung: nur betroffene Runs anfassen.
  const minimal = tryMinimalRunReplace(paragraphXml, runInfos, blanks)
  if (minimal) return { xml: minimal, replaced }

  // Fallback: Absatz aus Segmenten neu aufbauen (pPr bleibt).
  const openTag = paragraphXml.match(/^<w:p\b[^>]*>/)?.[0]
  if (!openTag) return { xml: paragraphXml, replaced: 0 }
  const pPr = paragraphXml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] ?? ''
  type Segment = { text: string; answer: boolean }
  const segments: Segment[] = []
  let last = 0
  for (const blank of blanks) {
    if (blank.start > last) {
      segments.push({ text: plain.slice(last, blank.start), answer: false })
    }
    segments.push({
      text: blank.value ?? plain.slice(blank.start, blank.end),
      answer: blank.value != null,
    })
    last = blank.end
  }
  if (last < plain.length) segments.push({ text: plain.slice(last), answer: false })
  const filledRuns = segments.map((seg) => docxTextRun(seg.text, seg.answer)).join('')
  return { xml: `${openTag}${pPr}${filledRuns}</w:p>`, replaced }
}

/**
 * Ersetzt nur die <w:r>-Blöcke, die mit Lücken überlappen; andere Runs bleiben.
 * Gelingt nur, wenn jede Lücke genau eine zusammenhängende Run-Sequenz abdeckt.
 */
function tryMinimalRunReplace(
  paragraphXml: string,
  runs: DocxRunInfo[],
  blanks: Array<{ start: number; end: number; value: string | null }>,
): string | null {
  const replacements: Array<{ fromXml: number; toXml: number; insert: string }> = []
  for (const blank of blanks) {
    if (blank.value == null) continue
    const touched = runs.filter((r) => {
      const end = r.plainStart + r.text.length
      return r.plainStart < blank.end && end > blank.start
    })
    if (touched.length === 0) return null
    const first = touched[0]!
    const last = touched[touched.length - 1]!
    const lastEnd = last.plainStart + last.text.length
    // Nur ersetzen, wenn die Lücke die betroffenen Runs vollständig abdeckt.
    if (first.plainStart < blank.start || lastEnd > blank.end) {
      return null
    }
    replacements.push({
      fromXml: first.xmlStart,
      toXml: last.xmlEnd,
      insert: docxTextRun(blank.value, true),
    })
  }

  replacements.sort((a, b) => b.fromXml - a.fromXml)
  let out = paragraphXml
  for (const rep of replacements) {
    out = out.slice(0, rep.fromXml) + rep.insert + out.slice(rep.toXml)
  }
  return out
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
 * Füllt leere Textboxen (w:txbxContent) sequenziell oder per targetId.
 */
export function fillDocxTextboxes(
  xml: string,
  solution: StructuredSolution,
): { xml: string; filled: number } {
  const byTarget = new Map<string, string>()
  for (const a of solution.answers) {
    if (a.targetId && a.answer.trim()) byTarget.set(a.targetId, a.answer.trim())
  }
  // Antworten ohne blankIndex, die noch nicht für Lücken vorgesehen sind.
  const sequential = solution.answers
    .filter((a) => a.answer.trim() && a.blankIndex == null && !a.targetId)
    .map((a) => a.answer.trim())

  let filled = 0
  let seq = 0
  let txIndex = 0
  const next = xml.replace(/<w:txbxContent>([\s\S]*?)<\/w:txbxContent>/g, (full, inner: string) => {
    const boxText = [...inner.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((x) => decodeXmlText(x[1] ?? ''))
      .join('')
      .trim()
    const id = `txbx-${txIndex}`
    txIndex += 1
    if (boxText.length > 0) return full

    const value =
      byTarget.get(id) ??
      solution.answers.find((a) => a.label.toLowerCase() === id)?.answer ??
      sequential[seq] ??
      null
    if (!value) return full
    if (!byTarget.has(id) && sequential[seq]) seq += 1
    filled += 1
    return `<w:txbxContent><w:p>${docxTextRun(value, true)}</w:p></w:txbxContent>`
  })
  return { xml: next, filled }
}

/**
 * Fügt eine verankerte Textbox (DrawingML) vor dem schließenden body-Tag ein.
 * Fallback für reine Vision-BBox-Ziele ohne native Shape-Referenz.
 */
export function insertAnchoredTextboxes(
  xml: string,
  items: Array<{ bbox: SolutionBBox; text: string; id: string }>,
): { xml: string; filled: number } {
  if (items.length === 0) return { xml, filled: 0 }
  const parts = items.map((item, i) => {
    const cx = Math.round((item.bbox.x + (item.bbox.w ?? 0.1) / 2) * 595 * 12700)
    const cy = Math.round((item.bbox.y + (item.bbox.h ?? 0.04) / 2) * 842 * 12700)
    const w = Math.round(Math.max(0.08, item.bbox.w ?? 0.15) * 595 * 12700)
    const h = Math.round(Math.max(0.03, item.bbox.h ?? 0.04) * 842 * 12700)
    return `<w:p><w:r><w:drawing>
      <wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${1000 + i}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"
        xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
        xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
        <wp:simplePos x="0" y="0"/>
        <wp:positionH relativeFrom="page"><wp:posOffset>${cx}</wp:posOffset></wp:positionH>
        <wp:positionV relativeFrom="page"><wp:posOffset>${cy}</wp:posOffset></wp:positionV>
        <wp:extent cx="${w}" cy="${h}"/>
        <wp:docPr id="${8000 + i}" name="saru-${escapeXml(item.id)}"/>
        <a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
          <wps:wsp><wps:txbx><w:txbxContent><w:p>${docxTextRun(item.text, true)}</w:p></w:txbxContent></wps:txbx></wps:wsp>
        </a:graphicData></a:graphic>
      </wp:anchor>
    </w:drawing></w:r></w:p>`
  })
  const injected = parts.join('')
  if (!/<\/w:body>/i.test(xml)) return { xml, filled: 0 }
  return {
    xml: xml.replace(/<\/w:body>/i, `${injected}</w:body>`),
    filled: items.length,
  }
}

/**
 * Markiert bereits eingetragene Lückenantworten in durchgängig unterstrichenen
 * Lehrerfassungen (kurze Wörter zwischen Space-Polstern) in Lösungstinte.
 */
export function highlightDocxPrefilledClozeAnswers(source: Buffer): {
  buffer: Buffer
  highlighted: number
} {
  const files = unzipSync(new Uint8Array(source))
  const docEntry = files['word/document.xml']
  if (!docEntry) return { buffer: source, highlighted: 0 }

  let xml = strFromU8(docEntry)
  let highlighted = 0

  xml = xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraphXml) => {
    const runs = collectDocxRuns(paragraphXml)
    if (runs.length < 3) return paragraphXml
    const hasPlain = runs.some(
      (run) =>
        !run.underlined && /\S/.test(run.text) && !/^[\s\u00a0_]+$/.test(run.text),
    )
    if (hasPlain) return paragraphXml

    const isSpacePad = (run: DocxRunInfo | undefined) =>
      Boolean(run && /^[\s\u00a0]+$/.test(run.text) && run.text.length >= 2)
    const isShortAnswer = (run: DocxRunInfo) => {
      const trimmed = run.text.trim()
      if (!trimmed || trimmed.length > 40) return false
      if ((trimmed.match(/\s+/g) ?? []).length > 2) return false
      return run.underlined && !/^[\s\u00a0_]+$/.test(run.text)
    }

    let next = paragraphXml
    // Von hinten nach vorne ersetzen, damit Offsets stabil bleiben.
    for (let i = runs.length - 1; i >= 0; i--) {
      const run = runs[i]!
      if (!isShortAnswer(run)) continue
      // Typisch: „   Hoden      “ – Antwortwort zwischen Space-Polstern.
      if (!isSpacePad(runs[i - 1]) || !isSpacePad(runs[i + 1])) continue
      const original = next.slice(run.xmlStart, run.xmlEnd)
      if (/w:val="1F4E9B"/i.test(original)) continue
      const colored = original.replace(
        /<w:rPr>([\s\S]*?)<\/w:rPr>/,
        (_full, inner: string) => {
          if (/<w:color\b/i.test(inner)) {
            return `<w:rPr>${inner.replace(
              /<w:color\b[^/]*\/>/i,
              `<w:color w:val="${SOLUTION_DOCX_COLOR}"/>`,
            )}</w:rPr>`
          }
          return `<w:rPr>${inner}<w:color w:val="${SOLUTION_DOCX_COLOR}"/><w:b/></w:rPr>`
        },
      )
      const withPr =
        colored === original
          ? original.replace(
              /<w:r\b([^>]*)>/,
              `<w:r$1><w:rPr><w:color w:val="${SOLUTION_DOCX_COLOR}"/><w:b/></w:rPr>`,
            )
          : colored
      if (withPr === original) continue
      next = next.slice(0, run.xmlStart) + withPr + next.slice(run.xmlEnd)
      highlighted += 1
    }
    return next
  })

  files['word/document.xml'] = strToU8(xml)
  return {
    buffer: Buffer.from(zipSync(files, { level: 6 })),
    highlighted,
  }
}

/**
 * Füllt Lücken in einem DOCX: Content Controls, Bookmarks, Textboxen und
 * Unterstrich-/Punktmuster. Offene Antworten können als Anhang folgen.
 */
export function fillDocxDocument(
  source: Buffer,
  solution: StructuredSolution,
  options: {
    title?: string
    notice?: string
    /** Zusätzliche Freitext-Antworten als Anhang, auch wenn In-place gefüllt wurde. */
    appendOpenAnswers?: boolean
    /** Erzwingt Anhang auch bei erfolgreicher In-place-Befüllung. */
    forceAppendix?: boolean
    /** Vision-/BBox-Ziele ohne native Ref. */
    anchoredOverlays?: Array<{ bbox: SolutionBBox; text: string; id: string }>
    /** Bereits in einem vorherigen Render-Schritt befüllte Ziele (Highlight/Diagramm). */
    priorFilled?: number
  } = {},
): {
  buffer: Buffer
  strategy: 'docx_inplace' | 'docx_appended' | 'docx_mixed'
  filled: number
} {
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
  let replaced = Math.max(0, options.priorFilled ?? 0)
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

  // Bookmarks: Text zwischen bookmarkStart/End ersetzen, wenn Name zur Antwort passt.
  xml = xml.replace(
    /<w:bookmarkStart([^>]*w:name="([^"]+)"[^>]*)\/>\s*([\s\S]*?)<w:bookmarkEnd[^>]*\/>/g,
    (full, _attrs: string, name: string, _inner: string) => {
      if (name.startsWith('_')) return full
      const match =
        solution.answers.find((a) => a.label.toLowerCase() === name.toLowerCase()) ??
        solution.answers.find((a) => a.id === name) ??
        solution.answers.find((a) => `task-${a.id}` === name.toLowerCase())
      if (!match?.answer) return full
      replaced += 1
      return `<w:bookmarkStart w:id="0" w:name="${escapeXml(name)}"/>${docxTextRun(match.answer, true)}<w:bookmarkEnd w:id="0"/>`
    },
  )

  const textboxes = fillDocxTextboxes(xml, solution)
  xml = textboxes.xml
  replaced += textboxes.filled

  const across = fillBlanksAcrossDocxRuns(xml, answers)
  xml = across.xml
  replaced += across.replaced

  if (options.anchoredOverlays?.length) {
    const anchored = insertAnchoredTextboxes(xml, options.anchoredOverlays)
    xml = anchored.xml
    replaced += anchored.filled
  }

  const bodyPlain = [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((m) => decodeXmlText(m[1] ?? ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()

  const answerAlreadyInBody = (answer: string) => {
    const normalized = answer.trim().toLowerCase().replace(/\s+/g, ' ')
    if (normalized.length < 2) return false
    // shape-/txbx-IDs sind nie sinnvolle Anhangstexte
    if (/^(shape|txbx|cc|bm)-\d+$/i.test(normalized)) return true
    return bodyPlain.includes(normalized)
  }

  const openAnswers = solution.answers.filter(
    (a) =>
      (a.fieldType === 'freitext' ||
        (a.blankIndex == null && !a.targetId && (a.answer?.length ?? 0) > 40)) &&
      !answerAlreadyInBody(a.answer),
  )
  const hasInPlaceTargets = solution.answers.some(
    (a) => a.targetId || typeof a.blankIndex === 'number',
  )
  const hasDiagramMarks = (solution.diagramMarks?.length ?? 0) > 0
  // Anhang nur wenn wirklich nichts In-place landete und Antworten nicht schon im Body stehen.
  const unplacedForAppendix =
    replaced === 0
      ? solution.answers.filter((a) => !answerAlreadyInBody(a.answer))
      : openAnswers
  const shouldAppend =
    options.forceAppendix ||
    (options.appendOpenAnswers && openAnswers.length > 0) ||
    (replaced === 0 &&
      unplacedForAppendix.length > 0 &&
      !hasDiagramMarks &&
      (openAnswers.length > 0 || !hasInPlaceTargets))

  if (shouldAppend && unplacedForAppendix.length > 0) {
    const appendixAnswers = { ...solution, answers: unplacedForAppendix }
    const bookmarkId = 9000
    const appendix = [
      `<w:bookmarkStart w:id="${bookmarkId}" w:name="saru-loesung"/>`,
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Musterlösung (KI)</w:t></w:r></w:p>',
      options.notice ? paragraphsToDocxXml(options.notice) : '',
      paragraphsToDocxXml(solutionToMarkdown(appendixAnswers)),
      `<w:bookmarkEnd w:id="${bookmarkId}"/>`,
    ].join('')
    xml = xml.replace(/<\/w:body>/i, `${appendix}</w:body>`)
  }

  files['word/document.xml'] = strToU8(xml)
  const strategy: 'docx_inplace' | 'docx_appended' | 'docx_mixed' =
    replaced > 0 && shouldAppend && openAnswers.length > 0
      ? 'docx_mixed'
      : replaced > 0
        ? 'docx_inplace'
        : shouldAppend
          ? 'docx_appended'
          : 'docx_inplace'
  return {
    buffer: Buffer.from(zipSync(files, { level: 6 })),
    strategy,
    filled: replaced,
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

/**
 * Entfernt minimale Markdown-Syntax aus Lösungstexten vor dem PDF-Rendering
 * (Listensterne, Fettung, Code), damit Helvetica keine Rohmarker zeigt.
 */
export function normalizeSolutionTextForPdf(text: string): string {
  return text
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[*+-]\s+/gm, '- ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
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
/** PDF-Y wächst nach oben: Kopfzeile (Name:/Datum) aussperren. */
const GAP_HEADER_BAND = 0.1
/** Fußzeile / Seitennummern / Autor. */
const GAP_FOOTER_BAND = 0.08
/** Ähnliche X-Positionen → Spaltengutter (Zweispaltigkeit). */
const GUTTER_X_TOLERANCE_PT = 28
const GUTTER_MIN_CLUSTER = 3

/** Füllmodus: echte Lücken vs. offene Aufgaben ohne Antwortplätze im Dokument. */
export type SolutionFillMode = 'lueckentext' | 'offen'

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

/** Run besteht nur aus Lückenfüllern (Unterstriche/Punkte), oft je Zeichen ein eigener Run. */
function isBlankFillerRun(text: string): boolean {
  const trimmed = text.replace(/\s+/g, '')
  if (!trimmed) return false
  return /^[_.…·•]+$/.test(trimmed)
}

const HEADER_FIELD_LABEL =
  /^(name|klasse|datum|kurs|schule|fach|thema|datum\/name|name\/datum)\s*:?\s*$/i

/**
 * Layout-Gaps (Kopfzeile, Tabellenköpfe, Zweispaltigkeit, Footer) – keine Cloze-Lücken.
 * Nur für kind=gap gedacht; Underscores bleiben unberührt.
 */
export function isLikelyLayoutGap(
  blank: Pick<PdfBlankRegion, 'x' | 'width' | 'leftText' | 'rightText' | 'kind'>,
  pageWidth: number,
): boolean {
  if (blank.kind !== 'gap') return false
  const left = (blank.leftText ?? '').replace(/\s+/g, ' ').trim()
  const right = (blank.rightText ?? '').replace(/\s+/g, ' ').trim()
  const combined = `${left} ${right}`

  // Kopfzeilen-Felder: „Name: ___ Titel“
  if (HEADER_FIELD_LABEL.test(left)) return true
  if (/^(name|klasse|datum)\s*:/i.test(left) && left.length <= 12) return true

  // Datum / Seitenzahl / Autor-Fußzeile
  if (/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/.test(combined)) return true
  if (/\bseite\s*\d+\s*\/\s*\d+\b/i.test(combined)) return true
  if (/\b[a-z0-9]+\.[a-z0-9]+@[a-z.]+\b/i.test(combined)) return true
  if (/\bja\.roesner\b/i.test(combined) || /\broesner\b/i.test(left) && /biologie|seite/i.test(right)) {
    return true
  }

  // Glossar-/Tabellenköpfe: „Begriff“ ↔ „Bedeutung“
  if (
    /^(begriff|begriffe|term|stichwort)$/i.test(left) &&
    /^(bedeutung|definition|erklärung|erkl[äa]rung|erlaeuterung)$/i.test(right)
  ) {
    return true
  }

  // Tabellenköpfe / kurze Labels ohne Satzzeichen
  const leftShort = left.length > 0 && left.length < 28
  const rightShort = right.length > 0 && right.length < 48
  const noSentencePunct = !/[.!?…]/.test(left) && !/[.!?…]/.test(right)
  if (
    leftShort &&
    rightShort &&
    noSentencePunct &&
    !/,/.test(left) &&
    /^[\p{L}\p{N}\s/\-–—]+$/u.test(left) &&
    /^[\p{L}\p{N}\s/\-–—,]+$/u.test(right)
  ) {
    // „Name“ ↔ „Symptome Behandlung Schutz“ o. Ä.
    const leftWords = left.split(/\s+/).filter(Boolean)
    const rightWords = right.split(/\s+/).filter(Boolean)
    if (leftWords.length <= 3 && rightWords.length <= 6) return true
  }

  // Zweispaltigkeit: Gap im mittleren Gutter, links Fließtext / rechts oft kurzer Begriff
  const gutterLeft = pageWidth * 0.32
  const gutterRight = pageWidth * 0.68
  const rightIsShortTerm =
    right.length >= 4 &&
    right.length <= 40 &&
    right.split(/\s+/).filter(Boolean).length <= 4
  if (
    blank.x >= gutterLeft &&
    blank.x <= gutterRight &&
    blank.width <= pageWidth * 0.28 &&
    left.length >= 18 &&
    rightIsShortTerm
  ) {
    return true
  }

  return false
}

/**
 * Entfernt Gap-Cluster mit ähnlicher X-Position (vertikaler Spaltengutter).
 * Underscore-Lücken bleiben erhalten.
 */
export function filterColumnGutterGaps<T extends Pick<PdfBlankRegion, 'pageIndex' | 'x' | 'kind'>>(
  blanks: T[],
): T[] {
  const gaps = blanks.filter((b) => b.kind === 'gap')
  if (gaps.length < GUTTER_MIN_CLUSTER) return blanks

  const drop = new Set<T>()
  const byPage = new Map<number, T[]>()
  for (const gap of gaps) {
    const list = byPage.get(gap.pageIndex) ?? []
    list.push(gap)
    byPage.set(gap.pageIndex, list)
  }

  for (const pageGaps of byPage.values()) {
    const used = new Set<T>()
    for (const seed of pageGaps) {
      if (used.has(seed)) continue
      const cluster = pageGaps.filter(
        (g) => Math.abs(g.x - seed.x) <= GUTTER_X_TOLERANCE_PT,
      )
      for (const g of cluster) used.add(g)
      if (cluster.length >= GUTTER_MIN_CLUSTER) {
        for (const g of cluster) drop.add(g)
      }
    }
  }

  if (drop.size === 0) return blanks
  return blanks.filter((b) => !drop.has(b))
}

/**
 * Offene Aufgaben (Beschreiben/Erklären…) ohne Wortliste/Unterstriche.
 * Layout-Gaps im Fließtext sollen dann nicht den Lückentext-Modus auslösen.
 */
export function looksLikeOpenEndedTaskText(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (/\b(wortliste|lückentext|fülle?\s+(die\s+)?lücken|lücken\s+mit|_____|_{3,})\b/i.test(t)) {
    return false
  }
  return /\b(beschreiben sie|erklären sie|erläutern sie|erörtern sie|vergleichen sie|diskutieren sie|nehmen sie stellung|begründen sie)\b/i.test(
    t,
  )
}

/**
 * Füllmodus: Unterstriche/erkannte Lücken → Lückentext.
 * Offene Aufgaben am Aufgabentext erkennen – nicht über aggressive Gap-Filter
 * (die echte Cloze-Lücken wie „bei allen Jungen ___“ verwerfen).
 */
export function classifySolutionFillMode(
  blanks: Array<Pick<PdfBlankRegion, 'kind'> | Pick<TextBlankInfo, 'kind'>>,
  documentText?: string | null,
): SolutionFillMode {
  const underscoreCount = blanks.filter(
    (b) => b.kind === 'underscore' || b.kind === 'underline',
  ).length
  if (underscoreCount > 0) return 'lueckentext'
  if (looksLikeOpenEndedTaskText(documentText ?? '')) return 'offen'
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
  // Kopf-/Fußzeilen erzeugen oft große Abstände (Titel ↔ Copyright / Name:), keine Lücken.
  if (lineY < pageHeight * GAP_FOOTER_BAND || lineY > pageHeight * (1 - GAP_HEADER_BAND)) {
    return
  }

  const maxGap = pageWidth * MAX_GAP_PAGE_FRACTION
  const lineHeight = Math.max(...content.map((r) => r.height), 10)

  // Semantische Runs: Lückenfüller („___“) überspringen – Abstand Wort→Füller→Wort zählt als eine Lücke.
  const semantic: Array<{ run: PdfTextRun; index: number }> = []
  for (let i = 0; i < content.length; i++) {
    if (isBlankFillerRun(content[i]!.str)) continue
    semantic.push({ run: content[i]!, index: i })
  }

  const pushGapOrUnderscore = (
    blank: Omit<PdfBlankRegion, 'blankIndex'>,
  ) => {
    if (
      blank.kind === 'gap' &&
      isLikelyLayoutGap(blank, pageWidth)
    ) {
      return
    }
    pushBlank(into, blank)
  }

  for (let s = 0; s < semantic.length - 1; s++) {
    const left = semantic[s]!
    const right = semantic[s + 1]!
    const gap = right.run.x - left.run.xEnd
    const hasFillerBetween = right.index > left.index + 1
    if (!hasFillerBetween && (gap < MIN_GAP_PT || gap > maxGap)) continue
    if (hasFillerBetween) {
      const fillerFirst = content[left.index + 1]!
      const fillerLast = content[right.index - 1]!
      const fillerWidth = fillerLast.xEnd - fillerFirst.x
      if (fillerWidth < MIN_GAP_PT * 0.5 && gap < MIN_GAP_PT) continue
    }

    const rightOk =
      looksLikeSentenceFragment(right.run.str) || /^[–—\-.,;:!?)]/.test(right.run.str.trim())
    if (!looksLikeSentenceFragment(left.run.str) || !rightOk) continue
    // Zwei Kurztitel mit riesigem Abstand → eher Layout (z. B. Kopfzeile) als Lücke.
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

    const blankX = hasFillerBetween ? content[left.index + 1]!.x : left.run.xEnd + 1
    const blankWidth = hasFillerBetween
      ? Math.max(MIN_GAP_PT, content[right.index - 1]!.xEnd - content[left.index + 1]!.x)
      : gap - 2

    pushGapOrUnderscore({
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
  if (
    !lonelyShort &&
    startGap >= MIN_GAP_PT &&
    startGap <= maxGap &&
    looksLikeSentenceFragment(first.str) &&
    (startsWithPunct || (content.length >= 2 && startGap >= MIN_GAP_PT * 1.5))
  ) {
    pushGapOrUnderscore({
      pageIndex,
      x: commonLeft,
      y: first.y,
      width: startGap - 1,
      height: lineHeight,
      kind: 'gap',
      leftText: previousLineText,
      rightText: content.map((r) => r.str).join(''),
    })
  }

  // Zeilenende-Lücke: letztes Wort, optional Unterstriche, optional nur Satzzeichen danach
  // („bei allen Jungen ___ .“ – oft gezeichnete Linie ohne Unterstrich-Text).
  const lastSem = semantic[semantic.length - 1]
  if (lastSem) {
    const after = content.slice(lastSem.index + 1)
    const fillers = after.filter((r) => isBlankFillerRun(r.str))
    const punct = after.filter(
      (r) => !isBlankFillerRun(r.str) && /^[.:;!?…,–—\-)\]]+$/.test(r.str.trim()),
    )
    const other = after.filter(
      (r) => !isBlankFillerRun(r.str) && !/^[.:;!?…,–—\-)\]]+$/.test(r.str.trim()),
    )
    if (other.length === 0 && (fillers.length > 0 || punct.length > 0)) {
      const leftJoined = content
        .slice(0, lastSem.index + 1)
        .map((r) => r.str)
        .join('')
      // Kein abgeschlossener Satz vor der Lücke.
      if (!/[.!?…]\s*$/.test(leftJoined.trim())) {
        const rightJoined = punct.map((r) => r.str).join('') || ''
        const blankX = fillers.length ? fillers[0]!.x : lastSem.run.xEnd + 1
        const blankEnd = fillers.length
          ? fillers[fillers.length - 1]!.xEnd
          : punct[0]
            ? punct[0].x
            : lastSem.run.xEnd + MIN_GAP_PT * 2
        const blankWidth = Math.max(MIN_GAP_PT, blankEnd - blankX)
        pushGapOrUnderscore({
          pageIndex,
          x: blankX,
          y: lastSem.run.y,
          width: blankWidth,
          height: lineHeight,
          kind: fillers.length ? 'underscore' : 'gap',
          leftText: leftJoined,
          rightText: rightJoined,
        })
      }
    }
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

    // Zweispaltige Layout-Gutter als Gap-Cluster entfernen (Unterstriche bleiben).
    const filtered = filterColumnGutterGaps(raw)

    filtered.sort((a, b) => {
      if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex
      if (Math.abs(a.y - b.y) > 3) return b.y - a.y
      return a.x - b.x
    })

    return filtered.map((blank, blankIndex) => ({ ...blank, blankIndex }))
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
 * Geometrie/Kontext der erkannten Lücke hat Vorrang vor Modell-Metadaten.
 */
export function alignAnswersToBlanks(
  solution: StructuredSolution,
  blanks: PdfBlankRegion[],
): StructuredSolution {
  if (blanks.length === 0 || solution.answers.length === 0) return solution

  const usedAnswers = new Set<number>()
  const byBlank = new Map<number, SolutionAnswer>()

  const assign = (answerIndex: number, blankIndex: number) => {
    if (byBlank.has(blankIndex) || usedAnswers.has(answerIndex)) return false
    const answer = solution.answers[answerIndex]
    const blank = blanks.find((b) => b.blankIndex === blankIndex)
    if (!answer || !blank) return false
    usedAnswers.add(answerIndex)
    byBlank.set(blankIndex, {
      ...answer,
      id: String(blankIndex + 1),
      label: `Lücke ${blankIndex + 1}`,
      blankIndex,
      page: blank.pageIndex + 1,
      // Immer Geometrie-Kontext – Modell-Kontext war oft vertauscht und verwirrte die UI.
      leftContext: blank.leftText || null,
      rightContext: blank.rightText || null,
      fieldType: answer.fieldType ?? 'luecke',
    })
    return true
  }

  // 1) Beste Kontext-Treffer zuerst (absteigend nach Score).
  const pairs: Array<{ answerIndex: number; blankIndex: number; score: number }> = []
  for (let ai = 0; ai < solution.answers.length; ai++) {
    const answer = solution.answers[ai]!
    if (!answer.leftContext && !answer.rightContext) continue
    for (const blank of blanks) {
      const score = scoreAnswerBlankMatch(answer, blank)
      if (score >= 3) pairs.push({ answerIndex: ai, blankIndex: blank.blankIndex, score })
    }
  }
  pairs.sort((a, b) => b.score - a.score)
  for (const pair of pairs) {
    assign(pair.answerIndex, pair.blankIndex)
  }

  // 2) Modell-blankIndex, sofern noch frei.
  for (let ai = 0; ai < solution.answers.length; ai++) {
    if (usedAnswers.has(ai)) continue
    const idx = solution.answers[ai]!.blankIndex
    if (typeof idx !== 'number' || idx < 0 || idx >= blanks.length) continue
    assign(ai, idx)
  }

  // 3) Rest in Dokumentreihenfolge auf freie Lücken.
  let answerCursor = 0
  for (const blank of blanks) {
    if (byBlank.has(blank.blankIndex)) continue
    while (answerCursor < solution.answers.length && usedAnswers.has(answerCursor)) {
      answerCursor += 1
    }
    if (answerCursor >= solution.answers.length) break
    assign(answerCursor, blank.blankIndex)
  }

  // Fehlende Lücken: Platzhalter, damit Overlay/Editor vollständig bleiben.
  for (const blank of blanks) {
    if (byBlank.has(blank.blankIndex)) continue
    byBlank.set(blank.blankIndex, {
      id: String(blank.blankIndex + 1),
      label: `Lücke ${blank.blankIndex + 1}`,
      answer: '???',
      blankIndex: blank.blankIndex,
      page: blank.pageIndex + 1,
      leftContext: blank.leftText || null,
      rightContext: blank.rightText || null,
      fieldType: 'luecke',
    })
  }

  const answers = [...byBlank.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, answer]) => answer)

  return { ...solution, answers }
}

/** Kompakte Darstellung für Logs (alle Lücken, nicht nur Sample). */
export function summarizeBlanksForLog(blanks: PdfBlankRegion[]): Array<Record<string, unknown>> {
  return blanks.map((b) => ({
    i: b.blankIndex,
    kind: b.kind,
    page: b.pageIndex + 1,
    left: b.leftText,
    right: b.rightText,
    x: Math.round(b.x),
    y: Math.round(b.y),
    w: Math.round(b.width),
  }))
}

export function summarizeAnswersForLog(
  answers: SolutionAnswer[],
): Array<Record<string, unknown>> {
  return answers.map((a) => ({
    id: a.id,
    label: a.label,
    answer: a.answer,
    blankIndex: a.blankIndex ?? null,
    left: a.leftContext ?? null,
    right: a.rightContext ?? null,
  }))
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
  const minimumFontSize = placement.fieldType === 'freitext' ? 6 : placement.fontSize
  let fontSize = placement.fontSize
  let lines = wrapTextToWidth(placement.text, font, fontSize, boxWidth)
  let lineHeight = fontSize + (placement.fieldType === 'freitext' ? 3 : 2)
  const fittedLineCount = () =>
    Math.max(
      1,
      1 +
        Math.floor(
          Math.max(0, placement.boxHeight - placement.fontSize) / lineHeight,
        ),
    )
  let fitted = fittedLineCount()

  while (
    placement.fieldType === 'freitext' &&
    lines.length > fitted &&
    fontSize > minimumFontSize
  ) {
    fontSize = Math.max(minimumFontSize, fontSize - 0.5)
    lines = wrapTextToWidth(placement.text, font, fontSize, boxWidth)
    lineHeight = fontSize + 3
    fitted = fittedLineCount()
  }

  if (lines.length === 0) return

  let baseline = Math.min(height - 4, Math.max(4, placement.baselineY))
  const visible = lines.slice(0, fitted)
  if (lines.length > fitted && visible.length > 0) {
    let last = visible[visible.length - 1]!.replace(/[.,;:!?\s]+$/g, '')
    while (last && font.widthOfTextAtSize(`${last}...`, fontSize) > boxWidth) {
      last = last.slice(0, -1).trimEnd()
    }
    visible[visible.length - 1] = last ? `${last}...` : '...'
  }
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
    const safe = sanitizePdfText(normalizeSolutionTextForPdf(text))
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
