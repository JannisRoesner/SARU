import type { CandidateBank, CandidateReusePolicy, CandidateTerm, DocumentModel } from './types'
import {
  detectImageLabelingTask,
  extractInlineTermList,
} from './worksheet-tasks'

/** Normalisiert für Vergleich: Kleinbuchstaben, Umlaute vereinheitlicht, Trim. */
export function normalizeCandidate(value: string): string {
  return value
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/ß/g, 'ss')
}

export interface ExtractCandidateBankInput {
  documentText?: string | null
  documentModel?: DocumentModel | null
  blankCount?: number
  /** Rohtext aus PDF-Extraktion, falls documentText leer. */
  pdfText?: string | null
  /** Kontexte aus erkannten Lücken (Fallback). */
  blankContexts?: string[]
}

function makeTerm(value: string, index: number): CandidateTerm {
  const trimmed = value.trim().replace(/^[-•*▪◦]\s*/, '').replace(/[.!?…,;:]+$/, '')
  return {
    id: `c${index}`,
    value: trimmed,
    normalized: normalizeCandidate(trimmed),
  }
}

function uniqueByNormalized(terms: CandidateTerm[]): CandidateTerm[] {
  const seen = new Set<string>()
  const out: CandidateTerm[] = []
  for (const term of terms) {
    if (!term.value || term.normalized.length < 2) continue
    if (seen.has(term.normalized)) continue
    seen.add(term.normalized)
    out.push({ ...term, id: `c${out.length}` })
  }
  return out
}

function resolveReusePolicy(
  candidates: CandidateTerm[],
  blankCount: number,
): CandidateReusePolicy {
  if (candidates.length === 0) return 'unknown'
  if (blankCount > 0 && candidates.length === blankCount) return 'once'
  if (blankCount > 0 && candidates.length < blankCount) return 'repeatable'
  return 'unknown'
}

const WORDLIST_HEADER =
  /(?:^|\n)\s*(?:wortliste|wörter(?:liste)?|begriffe|word\s*bank|füllen sie die lücken mit(?: den wörtern)?)\s*[:\-]?\s*/gi

const WORDLIST_MENTION =
  /wortliste|wörter(?:liste)?|begriffe|word\s*bank|füllen sie die lücken mit/i

/** True, wenn die Instruktion ausdrücklich eine Wortliste erwähnt. */
export function instructionExpectsCandidateBank(instruction: string): boolean {
  return WORDLIST_MENTION.test(instruction)
}

function collectTextSources(input: ExtractCandidateBankInput): string[] {
  const sources: string[] = []
  const model = input.documentModel

  if (model?.textBlocks.length) {
    for (const block of model.textBlocks) {
      if (WORDLIST_MENTION.test(block.text)) {
        sources.push(block.text)
      }
    }
    sources.push(model.textBlocks.map((b) => b.text).join('\n'))
  }

  if (input.documentText?.trim()) sources.push(input.documentText.trim())
  if (input.pdfText?.trim()) sources.push(input.pdfText.trim())
  if (model?.fullText?.trim()) sources.push(model.fullText.trim())

  if (input.blankContexts?.length) {
    sources.push(input.blankContexts.filter(Boolean).join('\n'))
  }

  const seen = new Set<string>()
  return sources.filter((text) => {
    const key = text.slice(0, 200)
    if (seen.has(key)) return false
    seen.add(key)
    return text.trim().length > 0
  })
}

function extractFromSingleText(text: string, blankCount: number): CandidateBank | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  // „Ordne die Begriffe dem Bild zu: A, B, C“
  const labeling = detectImageLabelingTask(trimmed)
  if (labeling?.terms && labeling.terms.length >= 2) {
    const candidates = uniqueByNormalized(
      labeling.terms.map((v, i) => makeTerm(v, i)),
    )
    if (candidates.length >= 2) {
      return {
        id: 'bank-1',
        candidates,
        reusePolicy: resolveReusePolicy(candidates, blankCount),
        source: 'instruction',
      }
    }
  }

  const fromAssign = extractFromAssignColonList(trimmed)
  if (fromAssign.length >= 2) {
    const candidates = uniqueByNormalized(fromAssign)
    if (candidates.length >= 2) {
      return {
        id: 'bank-1',
        candidates,
        reusePolicy: resolveReusePolicy(candidates, blankCount),
        source: 'instruction',
      }
    }
  }

  const fromSection = extractFromWordlistSection(trimmed)
  const candidates = uniqueByNormalized(fromSection)
  if (candidates.length < 2) return null

  return {
    id: 'bank-1',
    candidates,
    reusePolicy: resolveReusePolicy(candidates, blankCount),
    source: 'wordlist_section',
  }
}

/** „Ordne … zu: Harnröhre, Hoden, …“ ohne zwingend „Bild“. */
function extractFromAssignColonList(text: string): CandidateTerm[] {
  const m = text.match(
    /ordn\w*.{0,80}begriffe[^:]{0,40}:\s*((?:[\p{Lu}][\p{L}\p{N}\-]*)(?:\s*,\s*[\p{Lu}][\p{L}\p{N}\-]*){1,12})/iu,
  )
  if (!m?.[1]) return []
  return extractInlineTermList(m[1]).map((v, i) => makeTerm(v, i))
}

/**
 * Extrahiert eine Wortliste aus mehreren Textquellen.
 * Priorität: Wortlisten-Textblöcke → Dokumenttext → PDF-Text → Lückenkontexte.
 */
export function extractCandidateBankFromInput(
  input: ExtractCandidateBankInput,
): CandidateBank | null {
  const blankCount = input.blankCount ?? 0
  for (const text of collectTextSources(input)) {
    const bank = extractFromSingleText(text, blankCount)
    if (bank) return bank
  }
  return null
}

/**
 * Extrahiert eine Wortliste aus Dokumenttext.
 * Akzeptiert weiterhin (documentText, blankCount) für Abwärtskompatibilität.
 */
export function extractCandidateBank(
  inputOrText: ExtractCandidateBankInput | string | null | undefined,
  blankCount = 0,
): CandidateBank | null {
  if (typeof inputOrText === 'string' || inputOrText == null) {
    return extractCandidateBankFromInput({
      documentText: inputOrText ?? '',
      blankCount,
    })
  }
  return extractCandidateBankFromInput({
    blankCount,
    ...inputOrText,
  })
}

function extractFromWordlistSection(text: string): CandidateTerm[] {
  const matches = [...text.matchAll(WORDLIST_HEADER)]
  if (matches.length === 0) {
    const inline = text.match(/wortliste\s*[:\-]?\s*([^\n]{8,400})/i)
    if (inline?.[1]) {
      return tokenizeCandidateLine(inline[1]).map((v, i) => makeTerm(v, i))
    }
    // Wortlisten-Box ohne explizite Überschrift: kompakte Zeile mit Schrägstrichen.
    const slashList = text.match(
      /(?:^|\n)\s*([\p{L}][\p{L}\p{N}äöüÄÖÜß\-]{1,30}(?:\s*\/\s*[\p{L}][\p{L}\p{N}äöüÄÖÜß\-]{1,30}){3,})\s*(?:\n|$)/u,
    )
    if (slashList?.[1]) {
      return tokenizeCandidateLine(slashList[1]).map((v, i) => makeTerm(v, i))
    }
    return []
  }

  const terms: CandidateTerm[] = []
  for (const match of matches) {
    const start = (match.index ?? 0) + match[0].length
    const rest = text.slice(start)
    const stop = rest.search(
      /\n\s*\n|\n\s*(?:die|der|das|bei|fülle|aufgabe\s*\d)/i,
    )
    const chunk = (stop >= 0 ? rest.slice(0, stop) : rest.slice(0, 600)).trim()
    if (!chunk) continue

    const lines = chunk.split(/\n/).map((l) => l.trim()).filter(Boolean)
    // PDF-Textebene bricht Schrägstrich-Wortlisten oft mitten in der Liste um.
    const effectiveLines = joinSlashSeparatedLines(lines)

    if (effectiveLines.length >= 2) {
      for (const line of effectiveLines) {
        appendTermsFromLine(line, terms)
      }
    } else {
      for (const part of tokenizeCandidateLine(effectiveLines[0] ?? chunk)) {
        terms.push(makeTerm(part, terms.length))
      }
    }
  }
  return terms
}

/** True, wenn die Zeile Trennzeichen enthält und tokenisiert werden soll. */
function shouldTokenizeCandidateLine(line: string): boolean {
  if ((line.match(/,/g) ?? []).length >= 2) return true
  if (/[/|;•·]/.test(line)) return true
  if (/\s{2,}/.test(line)) return true
  return false
}

/**
 * Führt aufeinanderfolgende Schrägstrich-Zeilen zu einer Zeile zusammen
 * (PDF-Textebene bricht Wortlisten oft mitten in der Liste um).
 */
function joinSlashSeparatedLines(lines: string[]): string[] {
  if (lines.length < 2) return lines
  const out: string[] = []
  let buffer: string[] = []

  const flush = () => {
    if (buffer.length === 0) return
    out.push(buffer.join(' '))
    buffer = []
  }

  for (const line of lines) {
    if (line.includes('/')) {
      buffer.push(line)
    } else {
      flush()
      out.push(line)
    }
  }
  flush()
  return out
}

function appendTermsFromLine(line: string, terms: CandidateTerm[]): void {
  if (shouldTokenizeCandidateLine(line)) {
    const parts = tokenizeCandidateLine(line)
    if (parts.length >= 2) {
      for (const part of parts) {
        terms.push(makeTerm(part, terms.length))
      }
      return
    }
  }
  terms.push(makeTerm(line, terms.length))
}

function tokenizeCandidateLine(line: string): string[] {
  return line
    .split(/[,;|/•·]|\s{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && p.length <= 48 && /[\p{L}\p{N}]/u.test(p))
}

/** Baut eine CandidateBank aus extrahierten Wörtern (z. B. Vision-Repair). */
export function candidateBankFromWords(
  words: string[],
  blankCount = 0,
  source: CandidateBank['source'] = 'vision',
): CandidateBank | null {
  const candidates = uniqueByNormalized(
    words.map((value, index) => makeTerm(value, index)),
  )
  if (candidates.length < 2) return null
  return {
    id: source === 'vision' ? 'bank-vision' : 'bank-1',
    candidates,
    reusePolicy: resolveReusePolicy(candidates, blankCount),
    source,
  }
}

/** Kompakte Darstellung für Prompts. */
export function formatCandidateBankForPrompt(bank: CandidateBank): string {
  const words = bank.candidates.map((c) => c.value).join(', ')
  const policy =
    bank.reusePolicy === 'once'
      ? 'Jeden Begriff genau einmal verwenden.'
      : bank.reusePolicy === 'repeatable'
        ? 'Begriffe dürfen wiederholt werden, sofern nötig.'
        : 'Bevorzuge diese Begriffe; Wiederholung nur wenn nötig.'
  return [
    `Kandidaten (${bank.candidates.length}): ${words}`,
    `Wiederverwendung: ${bank.reusePolicy} – ${policy}`,
  ].join('\n')
}

/**
 * Findet den besten Kandidaten-Match für eine Antwort (oder null).
 * Exakter Match hat Vorrang. Fuzzy nur bei sehr ähnlicher Länge
 * (vermeidet „Schichten“ ⊆ „Hautschichten“).
 */
export function matchAnswerToCandidate(
  answer: string,
  bank: CandidateBank,
): CandidateTerm | null {
  const norm = normalizeCandidate(answer)
  if (!norm) return null
  const exact = bank.candidates.find((c) => c.normalized === norm)
  if (exact) return exact
  return (
    bank.candidates.find((c) => {
      const a = norm
      const b = c.normalized
      if (a.length < 5 || b.length < 5) return false
      if (Math.abs(a.length - b.length) > 2) return false
      return a.includes(b) || b.includes(a)
    }) ?? null
  )
}
