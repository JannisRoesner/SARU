/**
 * Extrahiert das erste gültige JSON-Objekt aus Modellantworten.
 * Toleriert Markdown-Fences, Einleitungstext und typische Formatfehler kleiner LLMs.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = stripCodeFences(text.trim())
  if (!cleaned) return null

  const candidates = collectJsonCandidates(cleaned)
  for (const candidate of candidates) {
    const parsed = tryParseObject(candidate)
    if (parsed) return parsed
  }

  return null
}

function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (fenced?.[1] ?? text).trim()
}

function collectJsonCandidates(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  const add = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) return
    seen.add(trimmed)
    out.push(trimmed)
  }

  add(text)

  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
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

    if (char === '{') {
      if (depth === 0) start = i
      depth++
      continue
    }

    if (char === '}' && depth > 0) {
      depth--
      if (depth === 0 && start >= 0) {
        add(text.slice(start, i + 1))
        start = -1
      }
    }
  }

  return out
}

function tryParseObject(raw: string): Record<string, unknown> | null {
  for (const candidate of repairVariants(raw)) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // Nächste Reparaturvariante probieren.
    }
  }
  return null
}

function repairVariants(raw: string): string[] {
  const normalized = raw
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/[\r\n\t]+/g, ' ')

  const variants = [raw, normalized]
  for (const base of [raw, normalized]) {
    variants.push(base.replace(/,\s*([}\]])/g, '$1'))
    variants.push(base.replace(/([{,]\s*)'([^'\\]*(?:\\.[^'\\]*)*)'/g, '$1"$2"'))
  }

  return [...new Set(variants)]
}
