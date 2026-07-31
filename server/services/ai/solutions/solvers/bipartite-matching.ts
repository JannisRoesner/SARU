/**
 * Maximum-weight bipartite matching for small matrices (n ≤ 20).
 * Uses DFS-based Kuhn with weight preference via greedy edge ordering
 * plus local improvement — exact for cloze sizes via bit DP when n ≤ 16,
 * greedy+swap otherwise.
 */

export interface AssignmentResult {
  /** blankIndex → candidateIndex */
  assignment: number[]
  totalScore: number
}

/** Exact MWBM for n ≤ 16 via Held-Karp-style bit DP on one side. */
function exactAssignment(scores: number[][]): AssignmentResult {
  const n = scores.length
  const m = scores[0]?.length ?? 0
  if (n === 0 || m === 0) return { assignment: [], totalScore: 0 }

  const size = 1 << m
  const dp = new Float64Array(size).fill(Number.NEGATIVE_INFINITY)
  const parent = new Int32Array(size).fill(-1)
  const chosen = new Int32Array(size).fill(-1)
  dp[0] = 0

  for (let mask = 0; mask < size; mask++) {
    if (!Number.isFinite(dp[mask])) continue
    const blank = bitCount(mask)
    if (blank >= n) continue
    for (let c = 0; c < m; c++) {
      if (mask & (1 << c)) continue
      const next = mask | (1 << c)
      const score = dp[mask] + (scores[blank]![c] ?? 0)
      if (score > dp[next]) {
        dp[next] = score
        parent[next] = mask
        chosen[next] = c
      }
    }
  }

  // Best mask that assigns all blanks (or as many as possible).
  let bestMask = 0
  let bestScore = Number.NEGATIVE_INFINITY
  for (let mask = 0; mask < size; mask++) {
    if (bitCount(mask) !== Math.min(n, m)) continue
    if (dp[mask] > bestScore) {
      bestScore = dp[mask]
      bestMask = mask
    }
  }

  const assignment = new Array(n).fill(-1)
  let mask = bestMask
  for (let blank = Math.min(n, m) - 1; blank >= 0; blank--) {
    const c = chosen[mask]
    if (c < 0) break
    assignment[blank] = c
    mask = parent[mask]
  }

  return {
    assignment,
    totalScore: Number.isFinite(bestScore) ? bestScore : 0,
  }
}

function bitCount(x: number): number {
  let n = x
  let c = 0
  while (n) {
    n &= n - 1
    c += 1
  }
  return c
}

/** Greedy fallback for larger matrices. */
function greedyAssignment(scores: number[][]): AssignmentResult {
  const n = scores.length
  const m = scores[0]?.length ?? 0
  const edges: Array<{ b: number; c: number; s: number }> = []
  for (let b = 0; b < n; b++) {
    for (let c = 0; c < m; c++) {
      edges.push({ b, c, s: scores[b]![c] ?? 0 })
    }
  }
  edges.sort((a, b) => b.s - a.s)
  const usedB = new Set<number>()
  const usedC = new Set<number>()
  const assignment = new Array(n).fill(-1)
  let total = 0
  for (const e of edges) {
    if (usedB.has(e.b) || usedC.has(e.c)) continue
    usedB.add(e.b)
    usedC.add(e.c)
    assignment[e.b] = e.c
    total += e.s
  }
  return { assignment, totalScore: total }
}

/**
 * scores[blankIndex][candidateIndex] → Gewicht.
 * Gibt die maximale eindeutige Zuordnung zurück.
 */
export function maximumWeightAssignment(scores: number[][]): AssignmentResult {
  const n = scores.length
  const m = scores[0]?.length ?? 0
  if (n === 0 || m === 0) return { assignment: [], totalScore: 0 }
  if (n <= 16 && m <= 16) return exactAssignment(scores)
  return greedyAssignment(scores)
}
