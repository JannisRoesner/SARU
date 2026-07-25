import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { createLogger } from '../utils/logger'
import { loadPdfjs } from '../utils/pdfjs'
import { extensionOf, resolveStoragePath } from './storage.service'

const log = createLogger('extraction')

export interface ExtractionResult {
  status: 'erfolgreich' | 'fehlgeschlagen' | 'nicht_unterstuetzt'
  text: string
  pageCount?: number
  error?: string
}

/** Obergrenze für indizierten Text – schützt Datenbank und Embedding-Kosten. */
const MAX_TEXT_LENGTH = 400_000

const EXTRACTABLE = new Set(['pdf', 'docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'txt', 'md', 'csv'])

export function isExtractable(fileName: string): boolean {
  return EXTRACTABLE.has(extensionOf(fileName))
}

export async function extractTextFromStorage(
  storageKey: string,
  fileName: string,
): Promise<ExtractionResult> {
  try {
    const buffer = await readFile(resolveStoragePath(storageKey))
    return await extractText(buffer, fileName)
  } catch (error) {
    log.warn('Textextraktion fehlgeschlagen', { storageKey, error })
    return { status: 'fehlgeschlagen', text: '', error: describe(error) }
  }
}

export async function extractText(buffer: Buffer, fileName: string): Promise<ExtractionResult> {
  const extension = extensionOf(fileName)
  if (!EXTRACTABLE.has(extension)) {
    return { status: 'nicht_unterstuetzt', text: '' }
  }

  try {
    switch (extension) {
      case 'pdf':
        return await extractPdf(buffer)
      case 'docx':
        return await extractDocx(buffer)
      case 'pptx':
        return extractOoxml(buffer, /^ppt\/slides\/slide\d+\.xml$/)
      case 'xlsx':
        return extractOoxml(buffer, /^xl\/sharedStrings\.xml$/)
      case 'odt':
      case 'odp':
      case 'ods':
        return extractOoxml(buffer, /^content\.xml$/)
      default:
        return { status: 'erfolgreich', text: truncate(buffer.toString('utf8')) }
    }
  } catch (error) {
    log.warn('Textextraktion fehlgeschlagen', { fileName, error })
    return { status: 'fehlgeschlagen', text: '', error: describe(error) }
  }
}

async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  // Der Legacy-Build von pdf.js kommt ohne Browser-APIs aus.
  const pdfjs = await loadPdfjs()

  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // Externe Ressourcen und Schriftarten werden für reine Textextraktion nicht benötigt.
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  })

  try {
    const document = await task.promise
    const pages: string[] = []
    let length = 0

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()

      // `hasEOL` markiert echte Zeilenenden – nur dort darf entsilbt werden.
      const lines: string[] = []
      let current = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        current += item.str
        if (item.hasEOL) {
          lines.push(current)
          current = ''
        }
      }
      if (current) lines.push(current)
      page.cleanup()

      const pageText = joinLines(lines)
      if (pageText) {
        pages.push(pageText)
        length += pageText.length
        if (length > MAX_TEXT_LENGTH) break
      }
    }

    const text = truncate(pages.join('\n\n'))
    return {
      // Ein PDF ganz ohne Textebene ist ein Scan – das ist kein Fehler, aber auch kein Erfolg.
      status: text.trim() ? 'erfolgreich' : 'nicht_unterstuetzt',
      text,
      pageCount: document.numPages,
      error: text.trim()
        ? undefined
        : 'Das PDF enthält keine Textebene und kann daher nicht durchsucht werden (vermutlich ein Scan).',
    }
  } finally {
    await task.destroy()
  }
}

/**
 * Wörter, die nach einem Bindestrich am Zeilenende eigenständig sind
 * („Schüler- und Lehrerschaft“) und deshalb nicht angebunden werden dürfen.
 */
const SUSPENDED_HYPHEN_FOLLOWERS =
  /^(und|oder|bzw|sowie|beziehungsweise|wie|als|aber|noch|auch)\b/i

function joinLines(lines: string[]): string {
  const out: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = normalizeDiacritics(lines[i]!).replace(/[ \t]+/g, ' ').trim()
    if (!line) continue

    const next = lines[i + 1] ? normalizeDiacritics(lines[i + 1]!).trim() : ''
    const hyphenated =
      /\p{L}-$/u.test(line) && /^\p{Ll}/u.test(next) && !SUSPENDED_HYPHEN_FOLLOWERS.test(next)

    if (hyphenated) {
      // Trennstrich entfernen und mit der Folgezeile verschmelzen.
      lines[i + 1] = line.slice(0, -1) + next
      continue
    }
    out.push(line)
  }

  return out.join('\n').trim()
}

/**
 * Viele (insbesondere mit LaTeX erzeugte) PDFs liefern Umlaute als getrennte
 * Akzentzeichen, z. B. `¨u` statt `ü`. Ohne diese Korrektur wären die Texte
 * für die deutsche Volltextsuche praktisch unbrauchbar.
 */
const SPACING_TO_COMBINING: Record<string, string> = {
  '\u00a8': '\u0308', // Trema
  '\u00b4': '\u0301', // Akut
  '\u0060': '\u0300', // Gravis
  '\u02c6': '\u0302', // Zirkumflex
  '\u02dc': '\u0303', // Tilde
  '\u00af': '\u0304', // Makron
  '\u02da': '\u030a', // Ring
  '\u00b8': '\u0327', // Cedille
  '\u02c7': '\u030c', // Hatschek
}

export function normalizeDiacritics(text: string): string {
  return text
    .replace(
      /([\u00a8\u00b4\u0060\u02c6\u02dc\u00af\u02da\u00b8\u02c7])[ ]?([aeiouyncszgAEIOUYNCSZG])/g,
      (_match, mark: string, letter: string) => letter + SPACING_TO_COMBINING[mark]!,
    )
    .normalize('NFC')
}

async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer })
  return { status: 'erfolgreich', text: truncate(result.value) }
}

/** Liest Text aus den XML-Teilen eines ZIP-basierten Office-Formats. */
function extractOoxml(buffer: Buffer, pattern: RegExp): ExtractionResult {
  const entries = unzipSync(new Uint8Array(buffer), {
    filter: (file) => pattern.test(file.name),
  })

  const decoder = new TextDecoder('utf-8')
  const names = Object.keys(entries).sort((a, b) =>
    a.localeCompare(b, 'de', { numeric: true }),
  )

  const parts = names.map((name) => xmlToText(decoder.decode(entries[name]!)))
  const text = truncate(parts.filter(Boolean).join('\n\n'))
  return { status: text.trim() ? 'erfolgreich' : 'nicht_unterstuetzt', text }
}

function xmlToText(xml: string): string {
  return xml
    // Absatz- und Zeilenwechsel vor dem Entfernen der Tags in Umbrüche überführen.
    .replace(/<\/(w:p|a:p|text:p|text:h)>/g, '\n')
    .replace(/<(w:br|a:br|text:line-break)\b[^>]*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function truncate(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').normalize('NFC').trim()
  return normalized.length > MAX_TEXT_LENGTH ? normalized.slice(0, MAX_TEXT_LENGTH) : normalized
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
