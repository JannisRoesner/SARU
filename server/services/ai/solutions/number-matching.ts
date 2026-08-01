import type { StructuredSolution } from '../document-fill'
import { normalizeCandidate } from './candidate-bank'
import type { CandidateBank, CandidateTerm } from './types'

/** Nummerierte Legende: Nummer → Begriff (z. B. 5 → Hoden). */
export interface NumberMatchingLegend {
  entries: Array<{ number: string; term: string }>
  numberToTerm: Map<string, string>
  termToNumber: Map<string, string>
}

export interface NumberMatchingTask extends NumberMatchingLegend {
  /** True, wenn die Instruktion Nummern (nicht Begriffe) verlangt. */
  expectsNumbers: true
}

const NUMBER_ANSWER_INSTRUCTION =
  /ordn\w*.{0,120}nummern?|nummern?\s+der\s+begriffe|trage\s+(?:die\s+)?(?:nummern?|zahlen|ziffern)|(?:nummern?|zahlen|ziffern)\s+(?:eintragen|zuordnen)|zuordnung\s+(?:der\s+)?nummern?|setze\s+die\s+(?:richtige\s+)?nummer|ordne\s+anschließend\s+die\s+nummern/i

/** True, wenn die Aufgabenstellung Nummern (nicht Begriffe) verlangt. */
export function instructionExpectsNumberAnswers(text: string): boolean {
  return NUMBER_ANSWER_INSTRUCTION.test(text)
}

/**
 * Extrahiert „1 Begriff 2 Begriff …“ oder zeilenweise „1. Begriff“.
 * Stoppt an Verben/Aussagen, die nach der Liste folgen.
 */
export function extractNumberedTermMap(text: string): NumberMatchingLegend | null {
  const fromLines = extractFromNumberedLines(text)
  if (fromLines && fromLines.entries.length >= 2) return fromLines

  const fromInline = extractFromInlineNumbers(text)
  if (fromInline && fromInline.entries.length >= 2) return fromInline

  return null
}

function buildLegend(
  pairs: Array<{ number: string; term: string }>,
): NumberMatchingLegend | null {
  const unique = new Map<string, string>()
  for (const { number, term } of pairs) {
    const cleaned = term
      .trim()
      .replace(/^[-•*▪◦]\s*/, '')
      .replace(/[.!?…,;:]+$/, '')
      .replace(/\s+/g, ' ')
    if (!cleaned || cleaned.length < 2 || cleaned.length > 48) continue
    if (!/^\d{1,2}$/.test(number)) continue
    if (!/[\p{L}]/u.test(cleaned)) continue
    // Keine ganzen Aussagensätze als „Begriff“.
    if (cleaned.split(/\s+/).length > 4) continue
    if (!unique.has(number)) unique.set(number, cleaned)
  }
  if (unique.size < 2) return null

  const entries = [...unique.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([number, term]) => ({ number, term }))

  const numberToTerm = new Map(entries.map((e) => [e.number, e.term]))
  const termToNumber = new Map(
    entries.map((e) => [normalizeCandidate(e.term), e.number]),
  )

  return { entries, numberToTerm, termToNumber }
}

function extractFromNumberedLines(text: string): NumberMatchingLegend | null {
  const pairs: Array<{ number: string; term: string }> = []
  const re = /(?:^|\n)\s*(\d{1,2})[.)]\s+([^\n]{2,60})/g
  for (const match of text.matchAll(re)) {
    pairs.push({ number: match[1]!, term: match[2]!.trim() })
  }
  return buildLegend(pairs)
}

function extractFromInlineNumbers(text: string): NumberMatchingLegend | null {
  const pairs: Array<{ number: string; term: string }> = []
  // z. B. „1 Cowpersche Drüsen 2 Prostata 3 Nebenhoden … 5 Hoden geben oft…“
  // Nur großgeschriebene Wörter (Begriffsnamen), nicht Folgesätze („Hoden geben oft…“).
  const re =
    /(?:^|[\s.])(\d{1,2})\s+((?:[\p{Lu}][\p{L}\p{N}\-äöüÄÖÜß]*)(?:\s+[\p{Lu}][\p{L}\p{N}\-äöüÄÖÜß]*){0,3})(?=\s+\d{1,2}\s+[\p{L}]|\s+[\p{Ll}]|\s*[.!?]|\s*$)/gu
  for (const match of text.matchAll(re)) {
    pairs.push({ number: match[1]!, term: match[2]!.trim() })
  }
  return buildLegend(pairs)
}

/** Erkennt Nummern-Zuordnungsaufgaben inkl. Legende. */
export function detectNumberMatchingTask(
  text: string,
): NumberMatchingTask | null {
  if (!text.trim()) return null
  if (!instructionExpectsNumberAnswers(text)) return null
  const legend = extractNumberedTermMap(text)
  if (!legend) return null
  return { ...legend, expectsNumbers: true }
}

/** Candidate-Bank aus Nummern („1“, „2“, …) für einmalige Zuordnung. */
export function numberMatchingCandidateBank(
  task: NumberMatchingLegend,
  blankCount = 0,
): CandidateBank {
  const candidates: CandidateTerm[] = task.entries.map((e, index) => ({
    id: `n${index}`,
    value: e.number,
    normalized: e.number,
  }))
  const reusePolicy =
    blankCount > 0 && candidates.length === blankCount
      ? 'once'
      : blankCount > 0 && candidates.length < blankCount
        ? 'repeatable'
        : candidates.length >= 2
          ? 'once'
          : 'unknown'
  return {
    id: 'bank-numbers',
    candidates,
    reusePolicy,
    source: 'instruction',
  }
}

/** Prompt-Abschnitt: nur Nummern eintragen. */
export function formatNumberMatchingForPrompt(task: NumberMatchingLegend): string {
  const legend = task.entries
    .map((e) => `${e.number} = ${e.term}`)
    .join('\n')
  return [
    'Die Aufgabenstellung verlangt Nummern zuzuordnen – NICHT die Begriffsnamen.',
    'Jeder answer-Wert darf NUR die Nummer sein (z. B. „5“), niemals „Hoden“ oder „5 Hoden“.',
    'Legende (Nummer → Begriff, nur zum Verständnis der Zuordnung):',
    legend,
    'Jeden Nummer genau einmal verwenden (bijektive Zuordnung zu den Lücken).',
  ].join('\n')
}

/**
 * Mappt Begriffsantworten auf Nummern, falls das Modell Begriffe statt Ziffern lieferte.
 */
export function coerceAnswersToNumbers(
  structured: StructuredSolution,
  task: NumberMatchingLegend,
): StructuredSolution {
  return {
    ...structured,
    answers: structured.answers.map((a) => ({
      ...a,
      answer: coerceOneAnswer(a.answer, task),
    })),
  }
}

function coerceOneAnswer(answer: string, task: NumberMatchingLegend): string {
  const trimmed = answer.trim()
  if (!trimmed) return trimmed

  if (/^\d{1,2}$/.test(trimmed) && task.numberToTerm.has(trimmed)) {
    return trimmed
  }

  const leading = trimmed.match(/^(\d{1,2})\b/)
  if (leading?.[1] && task.numberToTerm.has(leading[1])) {
    return leading[1]
  }

  const trailing = trimmed.match(/\((\d{1,2})\)\s*$/)
  if (trailing?.[1] && task.numberToTerm.has(trailing[1])) {
    return trailing[1]
  }

  const norm = normalizeCandidate(trimmed)
  const exact = task.termToNumber.get(norm)
  if (exact) return exact

  // Fuzzy: Antwort enthält Begriff, oder Begriff ≈ Antwort (nicht „Hoden“ ⊆ „Nebenhoden“).
  let best: { number: string; len: number } | null = null
  for (const [termNorm, number] of task.termToNumber) {
    if (termNorm.length < 3 || norm.length < 3) continue
    const answerHasTerm = norm.includes(termNorm)
    const nearEqual =
      termNorm.includes(norm) && Math.abs(termNorm.length - norm.length) <= 2
    if (!answerHasTerm && !nearEqual) continue
    if (!best || termNorm.length > best.len) {
      best = { number, len: termNorm.length }
    }
  }
  if (best) return best.number

  return trimmed
}
