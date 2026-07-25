export interface SolutionPromptContext {
  title: string
  description?: string | null
  materialType?: string | null
  subjects: string[]
  gradeLevels: number[]
  schoolForm?: string | null
  topics: string[]
  competencies: string[]
  learningObjectives: string[]
  pages?: string | null
  /** Bereits extrahierter Text des Materials, falls vorhanden. */
  documentText?: string | null
  /** Zusätzliche Hinweise der Lehrkraft für diesen Lauf. */
  userInstructions?: string | null
}

export const SOLUTION_PROMPT_VERSION = '1'

export const SOLUTION_SYSTEM_PROMPT = `Du bist eine erfahrene deutsche Lehrkraft und erstellst Musterlösungen für Unterrichtsmaterialien.

Regeln:
- Antworte ausschließlich auf Deutsch.
- Gib die Musterlösung als Markdown zurück, ohne umschließenden Code-Block.
- Beginne direkt mit der Lösung, ohne Einleitung wie "Hier ist die Musterlösung".
- Nummeriere die Lösungen genau so wie die Aufgaben im Material (z. B. "### Aufgabe 1", "**a)**").
- Löse jede erkennbare Aufgabe. Überspringe keine Teilaufgabe.
- Formuliere fachlich korrekt und in einer Sprache, die zur angegebenen Jahrgangsstufe passt.
- Gib bei offenen Aufgaben einen Erwartungshorizont mit den wesentlichen Aspekten an und kennzeichne ihn als solchen.
- Ergänze bei Bedarf kurze didaktische Hinweise unter der Überschrift "### Hinweise für die Lehrkraft".
- Wenn Aufgaben nicht eindeutig erkennbar sind, benenne das ausdrücklich unter der Überschrift "### Unklarheiten", statt Aufgaben zu erfinden.
- Erfinde keine Inhalte, die dem Material widersprechen.`

export function buildSolutionPrompt(context: SolutionPromptContext): string {
  const lines: string[] = ['Erstelle eine Musterlösung für das folgende Unterrichtsmaterial.', '']
  lines.push('## Angaben zum Material')
  lines.push(`- Titel: ${context.title}`)

  if (context.materialType) lines.push(`- Materialart: ${context.materialType}`)
  if (context.subjects.length) lines.push(`- Fach: ${context.subjects.join(', ')}`)
  if (context.gradeLevels.length) {
    lines.push(`- Jahrgangsstufe: ${context.gradeLevels.join(', ')}`)
  }
  if (context.schoolForm) lines.push(`- Schulform: ${context.schoolForm}`)
  if (context.topics.length) lines.push(`- Thema: ${context.topics.join(', ')}`)
  if (context.pages) lines.push(`- Seitenangaben: ${context.pages}`)
  if (context.description) lines.push(`- Beschreibung: ${context.description}`)
  if (context.competencies.length) {
    lines.push(`- Kompetenzen: ${context.competencies.join('; ')}`)
  }
  if (context.learningObjectives.length) {
    lines.push(`- Lernziele: ${context.learningObjectives.join('; ')}`)
  }

  if (context.documentText?.trim()) {
    lines.push('', '## Inhalt des Materials (automatisch aus der Datei extrahiert)', '')
    lines.push(context.documentText.trim())
  }

  if (context.userInstructions?.trim()) {
    lines.push('', '## Zusätzliche Hinweise der Lehrkraft', '', context.userInstructions.trim())
  }

  lines.push(
    '',
    'Die beigefügten Dateien bzw. Seitenbilder zeigen das Material im Original. Nutze sie, um Aufgabenstellungen, Abbildungen und Nummerierungen korrekt zu erfassen.',
  )

  return lines.join('\n')
}

/** Kennzeichnung, die jeder KI-Musterlösung im Text vorangestellt wird. */
export const AI_CONTENT_NOTICE =
  '> **Von künstlicher Intelligenz erstellt.** Diese Musterlösung wurde automatisch generiert und ist fachlich noch nicht geprüft. Bitte vor dem Einsatz im Unterricht kontrollieren.'
