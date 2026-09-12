import { extractJsonObject } from '../../../utils/json-parse'
import type { DifferentiatedTask, DifferentiatedWorksheet } from './prompts'

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function asStringList(value: unknown, limit = 20): string[] {
  if (!Array.isArray(value)) return []
  const items: string[] = []
  for (const entry of value) {
    const text = asString(entry)
    if (!text) continue
    items.push(text.slice(0, 300))
    if (items.length >= limit) break
  }
  return items
}

function asTask(raw: unknown, index: number): DifferentiatedTask | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const prompt = asString(row.prompt) ?? asString(row.text)
  if (!prompt) return null
  return {
    number: asString(row.number) ?? String(index + 1),
    title: asString(row.title),
    prompt: prompt.slice(0, 8000),
    hints: asStringList(row.hints, 8),
    figureNote: asString(row.figureNote),
  }
}

export function parseDifferentiatedWorksheet(
  raw: unknown,
  fallbackTitle: string,
): DifferentiatedWorksheet | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const tasks = Array.isArray(row.tasks)
    ? row.tasks.map((task, index) => asTask(task, index)).filter((task): task is DifferentiatedTask => Boolean(task))
    : []
  if (tasks.length === 0) return null

  const glossaryRaw = Array.isArray(row.glossary) ? row.glossary : []
  const glossary: DifferentiatedWorksheet['glossary'] = []
  for (const entry of glossaryRaw) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    const term = asString(item.term)
    const explanation = asString(item.explanation)
    if (!term || !explanation) continue
    glossary.push({ term: term.slice(0, 120), explanation: explanation.slice(0, 800) })
    if (glossary.length >= 20) break
  }

  return {
    title: (asString(row.title) ?? fallbackTitle).slice(0, 300),
    intro: asString(row.intro)?.slice(0, 4000) ?? null,
    tasks,
    wordBank: asStringList(row.wordBank, 30),
    glossary,
    uncertainties: asString(row.uncertainties)?.slice(0, 4000) ?? null,
  }
}

export function parseDifferentiatedWorksheetFromText(
  text: string,
  fallbackTitle: string,
): DifferentiatedWorksheet | null {
  return parseDifferentiatedWorksheet(extractJsonObject(text), fallbackTitle)
}

export function worksheetToPreviewMarkdown(sheet: DifferentiatedWorksheet): string {
  const lines: string[] = [`# ${sheet.title}`, '']
  if (sheet.intro) lines.push(sheet.intro, '')
  for (const task of sheet.tasks) {
    const heading = task.title ? `${task.number} ${task.title}` : task.number
    lines.push(`## Aufgabe ${heading}`, '', task.prompt, '')
    if (task.hints.length) {
      lines.push('Hinweise:', ...task.hints.map((hint) => `- ${hint}`), '')
    }
    if (task.figureNote) lines.push(`*${task.figureNote}*`, '')
  }
  if (sheet.wordBank.length) {
    lines.push('## Wortspeicher', '', sheet.wordBank.join(', '), '')
  }
  if (sheet.glossary.length) {
    lines.push('## Glossar', '')
    for (const item of sheet.glossary) lines.push(`- **${item.term}:** ${item.explanation}`)
    lines.push('')
  }
  if (sheet.uncertainties) {
    lines.push('## Unsicherheiten', '', sheet.uncertainties, '')
  }
  return lines.join('\n').trim()
}

export function worksheetFileName(sourceName: string | null | undefined, profileLabel: string): string {
  const base = (sourceName ?? 'Arbeitsblatt').replace(/\.[^.]+$/, '')
  const slug = profileLabel.replaceAll(/[^\wäöüÄÖÜß-]+/g, '-')
  return `${slug}-${base}.docx`
}
