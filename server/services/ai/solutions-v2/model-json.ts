import type { SolvedTask } from './types'

interface RawRanking {
  candidateId?: unknown
  score?: unknown
}

export interface ParsedTaskAnswer {
  targetId: string
  value: string
  rankings: Array<{ candidateId: string; score: number }>
}

export interface ParsedTaskSolution extends SolvedTask {
  parsedAnswers: ParsedTaskAnswer[]
}

function parseCompleteObject(raw: string): Record<string, unknown> | null {
  let text = raw.trim()
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced?.[1]) text = fenced[1].trim()
  if (!text.startsWith('{') || !text.endsWith('}')) return null
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export function parseTaskSolutionJson(raw: string): ParsedTaskSolution | null {
  const parsed = parseCompleteObject(raw)
  if (!parsed || typeof parsed.taskId !== 'string' || !Array.isArray(parsed.answers)) return null
  const answers: ParsedTaskAnswer[] = []
  for (const item of parsed.answers) {
    if (!item || typeof item !== 'object') return null
    const row = item as Record<string, unknown>
    const targetId = typeof row.targetId === 'string' ? row.targetId.trim() : ''
    const value = typeof row.value === 'string' || typeof row.value === 'number'
      ? String(row.value).trim()
      : ''
    if (!targetId || !value) return null
    const rankings = Array.isArray(row.rankings)
      ? row.rankings.flatMap((entry) => {
          if (!entry || typeof entry !== 'object') return []
          const ranking = entry as RawRanking
          const candidateId = typeof ranking.candidateId === 'string' ? ranking.candidateId : ''
          const score = Number(ranking.score)
          return candidateId && Number.isFinite(score)
            ? [{ candidateId, score: Math.max(0, Math.min(1, score)) }]
            : []
        })
      : []
    answers.push({ targetId, value, rankings })
  }
  return {
    taskId: parsed.taskId,
    answers: answers.map(({ targetId, value }) => ({ targetId, value })),
    parsedAnswers: answers,
    uncertainties: Array.isArray(parsed.uncertainties)
      ? parsed.uncertainties.map(String).filter(Boolean)
      : [],
  }
}

export interface SemanticVerdict {
  taskId: string
  verdict: 'pass' | 'repair' | 'uncertain'
  issues: Array<{ targetId: string | null; code: string; message: string }>
}

export function parseSemanticVerdict(raw: string): SemanticVerdict | null {
  const parsed = parseCompleteObject(raw)
  if (!parsed || typeof parsed.taskId !== 'string') return null
  if (!['pass', 'repair', 'uncertain'].includes(String(parsed.verdict))) return null
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const row = item as Record<string, unknown>
        return [{
          targetId: typeof row.targetId === 'string' ? row.targetId : null,
          code: typeof row.code === 'string' ? row.code : 'SEMANTIC_MISMATCH',
          message: typeof row.message === 'string' ? row.message : 'Semantische Prüfung fehlgeschlagen.',
        }]
      })
    : []
  return {
    taskId: parsed.taskId,
    verdict: parsed.verdict as SemanticVerdict['verdict'],
    issues,
  }
}

