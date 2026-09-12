export const DIFFERENZIERUNG_PROMPT_VERSION = 'differenzierung-v1'

export interface DifferentiatedTask {
  number: string
  title: string | null
  prompt: string
  hints: string[]
  figureNote: string | null
}

export interface DifferentiatedWorksheet {
  title: string
  intro: string | null
  tasks: DifferentiatedTask[]
  wordBank: string[]
  glossary: { term: string; explanation: string }[]
  uncertainties: string | null
}

export const DIFFERENZIERUNG_JSON_HINWEIS = `Antworte ausschließlich mit einem JSON-Objekt:
{
  "title": "Titel des Arbeitsblatts",
  "intro": "kurze Einleitung oder null",
  "tasks": [
    {
      "number": "1",
      "title": "optionaler Aufgabentitel oder null",
      "prompt": "Arbeitsauftrag als Fließtext. Zeilenumbrüche erlaubt.",
      "hints": ["optionale Hilfen, sonst leeres Array"],
      "figureNote": "Abbildung wie im Original (Aufgabe 1) oder null"
    }
  ],
  "wordBank": ["nur bei Bedarf, sonst []"],
  "glossary": [{ "term": "Wort", "explanation": "Erklärung" }],
  "uncertainties": "Was unklar war oder null"
}`

export function buildDifferentiationSystemPrompt(profileRules: string): string {
  return `Du bist eine erfahrene Lehrkraft in Hessen und arbeitest Differenzierungsfassungen von Arbeitsblättern aus.

Regeln:
- Du darfst den Fachinhalt nicht verdrehen, abschwächen bis zur Falschaussage oder neue Fakten erfinden.
- Behalte die Reihenfolge der Aufgaben, soweit das Profil nichts anderes verlangt.
- Operatoren und Erwartungen müssen zum Profil passen, aber zum selben Thema gehören.
- Fehlende Abbildungen nicht beschreiben, als gäbe es sie neu: nur auf das Original verweisen.
- Unsicherheiten (unleserlicher Text, fehlende Abbildungen, mehrdeutige Aufgaben) in "uncertainties" nennen.
- Keine Musterlösungen, keine Lehrerkommentare, kein Metatext außerhalb des JSON.

Profil:
${profileRules}

${DIFFERENZIERUNG_JSON_HINWEIS}`
}

export function buildDifferentiationUserPrompt(options: {
  materialTitle: string
  profileLabel: string
  sourceFileName: string | null
  documentText: string
  userInstructions?: string | null
}): string {
  const hinweis = options.userInstructions?.trim()
  return `Materialtitel: ${options.materialTitle}
Profil: ${options.profileLabel}
Quelldatei: ${options.sourceFileName ?? 'unbekannt'}
${hinweis ? `\nZusätzliche Hinweise der Lehrkraft:\n${hinweis}\n` : ''}
Originaltext des Arbeitsblatts:
---
${options.documentText}
---`
}
