import { formatJahrgaenge, type GradeLevel } from '#shared/utils/jahrgangsstufen'

export interface SolutionPromptContext {
  title: string
  description?: string | null
  materialType?: string | null
  subjects: string[]
  gradeLevels: GradeLevel[]
  schoolForm?: string | null
  topics: string[]
  competencies: string[]
  learningObjectives: string[]
  pages?: string | null
  /** Bereits extrahierter Text des Materials, falls vorhanden. */
  documentText?: string | null
  /** Zusätzliche Hinweise der Lehrkraft für diesen Lauf. */
  userInstructions?: string | null
  /** Dateiname der Quelldatei (hilft bei Formularfeld-Namen). */
  sourceFileName?: string | null
  sourceMimeType?: string | null
  /**
   * Maschinell erkannte Lücken mit Index und Textkontext (PDF-Geometrie).
   * Wenn gesetzt, MUSS blankIndex genau diese Liste verwenden.
   */
  blankInventory?: string | null
  detectedBlankCount?: number | null
}

export const SOLUTION_PROMPT_VERSION = '5-blank-context'

export const SOLUTION_SYSTEM_PROMPT = `Du bist eine erfahrene deutsche Lehrkraft und erstellst Musterlösungen für Unterrichtsmaterialien.

Ziel: Die Antworten werden visuell in das Original-Arbeitsblatt geschrieben (PDF-Seiten bleiben erhalten, Text wird in die Lücken gelegt). Du lieferst strukturierte Antworten; die Platzierung nutzt blankIndex und den Textkontext links/rechts der Lücke.

Regeln:
- Antworte ausschließlich auf Deutsch.
- Gib ausschließlich ein JSON-Objekt zurück (kein Markdown drumherum, kein Einleitungstext).
- Schema:
{
  "summary": "kurzer Überblick in 1–2 Sätzen",
  "answers": [
    {
      "id": "1",
      "label": "Aufgabe 1a",
      "answer": "ausgefüllte Antwort / Lösungstext (knapp, passend in die Lücke)",
      "page": 1,
      "blankIndex": 0,
      "leftContext": "kurzer Text unmittelbar links der Lücke",
      "rightContext": "kurzer Text unmittelbar rechts der Lücke",
      "bbox": { "x": 0.42, "y": 0.28, "w": 0.35, "h": 0.028 }
    }
  ],
  "formFields": [
    { "name": "ExactFormFieldName", "value": "Wert" }
  ],
  "notesForTeacher": "optionale didaktische Hinweise",
  "uncertainties": "falls Aufgaben unklar sind"
}
- Nummeriere und benenne Antworten genau wie im Material (Aufgabe 1, a), …).
- page: 1-basierte Seitenzahl, auf der die Lücke liegt.
- Semantik zuerst: Jede answer muss im Satzkontext der konkreten Lücke grammatisch und fachlich passen (z. B. „Die ___ des Penis“ → „Eichel“, nicht ein anderes Wort aus der Wortliste).
- blankIndex:
  - Wenn eine maschinelle Lückenliste im User-Prompt steht: verwende GENAU diese Indizes (0…n-1). Keine eigenen Nummern erfinden, keine Lücke überspringen, keine Extra-Antworten ohne Lücke.
  - Sonst: Reihenfolge aller optischen Lücken im Dokument von oben nach unten, bei Gleichstand links nach rechts, beginnend bei 0.
  - Lücken sind: Unterstriche, Punktlinien, Antwortlinien, leere Kästen ODER sichtbare Lücken im Fließtext (auch ohne „___“-Zeichen).
- leftContext / rightContext: jeweils wenige Wörter unmittelbar vor bzw. nach der Lücke (wie im Dokument), damit die Zuordnung robust ist.
- bbox (Fallback, wenn keine Text-Lücken erkannt werden – z. B. Scans):
  - Normierte Koordinaten 0.0–1.0 relativ zur Seite.
  - Ursprung oben links (wie auf dem Seitenbild): x nach rechts, y nach unten.
  - x/y = obere linke Ecke der konkreten Lücke im Satz (nicht die Wortliste, nicht der Leerraum darüber/darunter).
  - w/h = Breite/Höhe der Lückenregion (Unterstrich/Lücke selbst).
  - Niemals Positionen in großen Weißflächen schätzen, die keine Lücke sind.
- answer: möglichst kurz und lückengerecht (Einzelwort, Zahl, kurzer Satz) – kein Aufsatz, außer die Aufgabe verlangt Fließtext. Nicht an Wortlisten-Reihenfolge kleben – die Wortliste ist nur ein Fundus.
- formFields: nur bei echten PDF-/Word-Formularfeldern; "name" muss dem Feldnamen entsprechen, soweit erkennbar.
- Löse jede erkennbare Aufgabe. Überspringe keine Teilaufgabe.
- Formuliere fachlich korrekt und altersgerecht.
- Bei offenen Aufgaben: knapper Erwartungshorizont als answer-Text.
- Erfinde keine Inhalte, die dem Material widersprechen.
- Wenn keine Lücken erkennbar sind, liefere trotzdem vollständige answers mit Labels und sinnvollen bbox-Schätzungen nahe der Aufgabenstellung.`

export function buildSolutionPrompt(context: SolutionPromptContext): string {
  const lines: string[] = [
    'Erstelle eine ausfüllbare Musterlösung für das folgende Unterrichtsmaterial.',
    'Die Antworten werden maschinell in die Dokumentlücken geschrieben.',
    'Wichtig: Jede Antwort muss semantisch zum Satzkontext ihrer Lücke passen; blankIndex allein reicht nicht.',
    '',
    '## Angaben zum Material',
  ]
  lines.push(`- Titel: ${context.title}`)

  if (context.materialType) lines.push(`- Materialart: ${context.materialType}`)
  if (context.sourceFileName) lines.push(`- Dateiname: ${context.sourceFileName}`)
  if (context.sourceMimeType) lines.push(`- MIME-Typ: ${context.sourceMimeType}`)
  if (context.subjects.length) lines.push(`- Fach: ${context.subjects.join(', ')}`)
  if (context.gradeLevels.length) {
    lines.push(`- Jahrgangsstufe: ${formatJahrgaenge(context.gradeLevels)}`)
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

  if (context.blankInventory?.trim()) {
    lines.push(
      '',
      `## Erkannte Lücken (${context.detectedBlankCount ?? 'n'} Stück) – verbindliche blankIndex-Liste`,
      'Fülle jede dieser Lücken genau einmal. blankIndex muss der Nummer links entsprechen.',
      'Die answer muss in „linker Kontext ___ rechter Kontext“ Sinn ergeben.',
      '',
      context.blankInventory.trim(),
    )
  }

  if (context.userInstructions?.trim()) {
    lines.push('', '## Zusätzliche Hinweise der Lehrkraft', '', context.userInstructions.trim())
  }

  lines.push(
    '',
    'Die beigefügten Dateien bzw. Seitenbilder zeigen das Material im Original.',
    'Erkenne Aufgaben, Abbildungen, Lücken und Formularfelder multimodal.',
    context.blankInventory?.trim()
      ? 'Für jede erkannte Lücke: answer + page + blankIndex (aus der Liste) + leftContext + rightContext + bbox.'
      : 'Für jede Lücke: answer + page + blankIndex (Dokumentreihenfolge) + leftContext + rightContext + bbox (normiert 0–1, Ursprung oben links).',
    'Liefere ausschließlich das JSON-Objekt.',
  )

  return lines.join('\n')
}

/** Kurzer Hinweis für das Inhaltsfeld / Dokumentkopf. */
export const AI_CONTENT_NOTICE =
  'Von künstlicher Intelligenz erstellt. Diese Musterlösung wurde automatisch generiert und ist fachlich noch nicht geprüft. Bitte vor dem Einsatz im Unterricht kontrollieren.'

/** Markdown-Variante für optionales Inhaltsfeld. */
export const AI_CONTENT_NOTICE_MD =
  '> **Von künstlicher Intelligenz erstellt.** Diese Musterlösung wurde automatisch generiert und ist fachlich noch nicht geprüft. Bitte vor dem Einsatz im Unterricht kontrollieren.'
