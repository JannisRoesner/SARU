import type { StructuredSolution, SolutionAnswer } from '../../document-fill'
import { matchAnswerToCandidate, normalizeCandidate } from '../candidate-bank'
import type { CandidateBank } from '../types'
import { maximumWeightAssignment } from './bipartite-matching'

export interface BlankFrame {
  blankIndex: number
  leftText: string
  rightText: string
  page?: number
}

/**
 * Baut eine Score-Matrix aus Modell-Antworten: hohe Scores für genannte
 * Kandidaten in der Modell-Reihenfolge, Bonus wenn Grammatik-Kontext passt.
 * Anschließend globale bijektive Zuordnung.
 */
export function assignCandidatesGlobally(
  solution: StructuredSolution,
  bank: CandidateBank,
  blanks: BlankFrame[],
): StructuredSolution {
  if (bank.reusePolicy !== 'once' || blanks.length === 0 || bank.candidates.length === 0) {
    return solution
  }

  const n = blanks.length
  const m = bank.candidates.length
  const scores: number[][] = Array.from({ length: n }, () => Array(m).fill(0))

  // Modell-Präferenz: Antwort i schlägt Kandidat vor → hoher Score an Blank i.
  for (let i = 0; i < Math.min(solution.answers.length, n); i++) {
    const answer = solution.answers[i]!
    const blankIdx =
      typeof answer.blankIndex === 'number' ? answer.blankIndex : i
    if (blankIdx < 0 || blankIdx >= n) continue
    const match = matchAnswerToCandidate(answer.answer, bank)
    if (match) {
      const ci = bank.candidates.findIndex((c) => c.normalized === match.normalized)
      if (ci >= 0) scores[blankIdx]![ci] = Math.max(scores[blankIdx]![ci]!, 0.95)
    }
    // Schwache Scores für alle Kandidaten, die im left/right Kontext grammatisch passen.
    const left = (answer.leftContext ?? blanks[blankIdx]?.leftText ?? '').toLowerCase()
    const right = (answer.rightContext ?? blanks[blankIdx]?.rightText ?? '').toLowerCase()
    for (let ci = 0; ci < m; ci++) {
      const word = bank.candidates[ci]!.value
      let s = scores[blankIdx]![ci] ?? 0
      // Artikel + Substantiv Heuristik
      if (/\b(der|die|das|den|dem|des|ein|eine|einer|einem)\s*$/i.test(left.trim())) {
        if (/^[A-ZÄÖÜ]/.test(word)) s = Math.max(s, 0.35)
      }
      if (/^(sehr|ganz|besonders)\s*$/i.test(left.trim().split(/\s+/).slice(-1)[0] ?? '')) {
        if (/lich$|ig$|bar$/i.test(word)) s = Math.max(s, 0.4)
      }
      if (/^[.:;!?…]/.test(right.trim()) || right.trim() === '') {
        s = Math.max(s, 0.15)
      }
      scores[blankIdx]![ci] = s
    }
  }

  // Falls Modell nichts Brauchbares lieferte: gleichmäßige Basis + leichte Kontext-Scores.
  const hasSignal = scores.some((row) => row.some((v) => v >= 0.5))
  if (!hasSignal) {
    for (let b = 0; b < n; b++) {
      for (let c = 0; c < m; c++) {
        scores[b]![c] = 0.1 + scoreContextFit(bank.candidates[c]!.value, blanks[b]!)
      }
    }
  }

  const { assignment } = maximumWeightAssignment(scores)
  const answers: SolutionAnswer[] = blanks.map((blank, bi) => {
    const ci = assignment[bi] ?? -1
    const candidate = ci >= 0 ? bank.candidates[ci] : null
    const prev = solution.answers.find((a) => a.blankIndex === blank.blankIndex) ?? solution.answers[bi]
    return {
      id: String(blank.blankIndex + 1),
      label: `Lücke ${blank.blankIndex + 1}`,
      answer: candidate?.value ?? prev?.answer ?? '???',
      blankIndex: blank.blankIndex,
      page: blank.page ?? prev?.page ?? 1,
      leftContext: blank.leftText || prev?.leftContext || null,
      rightContext: blank.rightText || prev?.rightContext || null,
      fieldType: 'luecke' as const,
      bbox: prev?.bbox ?? null,
    }
  })

  return {
    ...solution,
    answers,
  }
}

function scoreContextFit(word: string, blank: BlankFrame): number {
  const left = blank.leftText.trim().toLowerCase()
  const right = blank.rightText.trim().toLowerCase()
  let s = 0
  if (/\b(der|die|das|den|dem|des|ein|eine)\s*$/i.test(left) && /^[A-ZÄÖÜ]/.test(word)) {
    s += 0.25
  }
  if (/sehr$/i.test(left) && /lich$|ig$/i.test(word)) s += 0.3
  if (/^–|^-|^—/.test(right) && /enden|en$/i.test(word)) s += 0.2
  if (normalizeCandidate(left).includes('jungen') && /lang|kurz|unterschiedlich/i.test(word)) {
    s += 0.35
  }
  return s
}

/**
 * Parst optionale Score-Matrix aus dem Modell:
 * answers[].rankings = [{ candidate, score }] oder answer als Wort.
 */
export function scoresFromRankings(
  solution: StructuredSolution,
  bank: CandidateBank,
  blankCount: number,
): number[][] | null {
  const n = blankCount
  const m = bank.candidates.length
  if (n === 0 || m === 0) return null

  let anyRanking = false
  const scores: number[][] = Array.from({ length: n }, () => Array(m).fill(0))

  for (const answer of solution.answers) {
    const bi =
      typeof answer.blankIndex === 'number' ? answer.blankIndex : Number(answer.id) - 1
    if (bi < 0 || bi >= n) continue
    const raw = answer as SolutionAnswer & {
      rankings?: Array<{ candidate?: string; score?: number }>
    }
    if (Array.isArray(raw.rankings) && raw.rankings.length > 0) {
      anyRanking = true
      for (const row of raw.rankings) {
        const match = matchAnswerToCandidate(String(row.candidate ?? ''), bank)
        if (!match) continue
        const ci = bank.candidates.findIndex((c) => c.normalized === match.normalized)
        if (ci >= 0) scores[bi]![ci] = Number(row.score) || 0
      }
    } else {
      const match = matchAnswerToCandidate(answer.answer, bank)
      if (match) {
        const ci = bank.candidates.findIndex((c) => c.normalized === match.normalized)
        if (ci >= 0) {
          scores[bi]![ci] = 1
          anyRanking = true
        }
      }
    }
  }

  return anyRanking ? scores : null
}
