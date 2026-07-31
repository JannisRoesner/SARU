import type { CandidateBank, CandidateReusePolicy, CandidateTerm } from './types'

/** Normalisiert für Vergleich: Kleinbuchstaben, Umlaute vereinheitlicht, Trim. */
export function normalizeCandidate(value: string): string {
  return value
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/ß/g, 'ss')
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

/**
 * Extrahiert eine Wortliste aus Dokumenttext.
 * Sucht Abschnitte nach „Wortliste“ / „Wörter:“ und tokenisiert per Komma/Zeile/Bullet.
 */
export function extractCandidateBank(
  documentText: string | null | undefined,
  blankCount = 0,
): CandidateBank | null {
  const text = (documentText ?? '').trim()
  if (!text) return null

  const fromSection = extractFromWordlistSection(text)
  const candidates = uniqueByNormalized(fromSection)
  if (candidates.length < 2) return null

  return {
    id: 'bank-1',
    candidates,
    reusePolicy: resolveReusePolicy(candidates, blankCount),
    source: 'wordlist_section',
  }
}

function extractFromWordlistSection(text: string): CandidateTerm[] {
  const matches = [...text.matchAll(WORDLIST_HEADER)]
  if (matches.length === 0) {
    // Fallback: kurze kommagetrennte Liste in einer Zeile mit „Wortliste“ irgendwo.
    const inline = text.match(
      /wortliste\s*[:\-]?\s*([^\n]{8,400})/i,
    )
    if (inline?.[1]) {
      return tokenizeCandidateLine(inline[1]).map((v, i) => makeTerm(v, i))
    }
    return []
  }

  const terms: CandidateTerm[] = []
  for (const match of matches) {
    const start = (match.index ?? 0) + match[0].length
    // Bis zur nächsten Leerzeile + 2 Zeilen oder bis Lückentext beginnt.
    const rest = text.slice(start)
    const stop = rest.search(
      /\n\s*\n|\n\s*(?:die|der|das|bei|fülle|aufgabe\s*\d)/i,
    )
    const chunk = (stop >= 0 ? rest.slice(0, stop) : rest.slice(0, 600)).trim()
    if (!chunk) continue

    // Mehrzeilig: eine Zeile = ein Kandidat, oder kommagetrennt.
    const lines = chunk.split(/\n/).map((l) => l.trim()).filter(Boolean)
    if (lines.length >= 2) {
      for (const line of lines) {
        // Zeile mit vielen Kommas → weiter tokenisieren
        if ((line.match(/,/g) ?? []).length >= 2) {
          for (const part of tokenizeCandidateLine(line)) {
            terms.push(makeTerm(part, terms.length))
          }
        } else {
          terms.push(makeTerm(line, terms.length))
        }
      }
    } else {
      for (const part of tokenizeCandidateLine(chunk)) {
        terms.push(makeTerm(part, terms.length))
      }
    }
  }
  return terms
}

function tokenizeCandidateLine(line: string): string[] {
  return line
    .split(/[,;|/•·]|\s{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && p.length <= 48 && /[\p{L}\p{N}]/u.test(p))
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
      // Nur bei nahezu gleicher Länge (Flexion/Tippfehler), nie echte Teilstrings.
      if (Math.abs(a.length - b.length) > 2) return false
      return a.includes(b) || b.includes(a)
    }) ?? null
  )
}
