import { formatJahrgaenge, type GradeLevel } from '#shared/utils/jahrgangsstufen'
import type { SolutionFillMode } from './document-fill'
import { formatCandidateBankForPrompt } from './solutions/candidate-bank'
import type { CandidateBank } from './solutions/types'

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
  /**
   * lueckentext = Antworten in Dokumentlücken; offen = Erwartungshorizont ohne Lückenfüllung.
   * Wird aus der Lückenerkennung abgeleitet, falls nicht gesetzt.
   */
  fillMode?: SolutionFillMode | null
  /** Strukturierte Wortliste – verbindlich wenn gesetzt. */
  candidateBank?: CandidateBank | null
}

export const SOLUTION_PROMPT_VERSION = '7-candidate-bank-task-pipeline'

const SOLUTION_JSON_SCHEMA = `{
  "summary": "kurzer Überblick in 1–2 Sätzen",
  "answers": [
    {
      "id": "1",
      "label": "Aufgabe 1a",
      "answer": "Lösungstext",
      "page": 1,
      "blankIndex": 0,
      "leftContext": "kurzer Text unmittelbar links der Lücke",
      "rightContext": "kurzer Text unmittelbar rechts der Lücke",
      "fieldType": "luecke",
      "bbox": { "x": 0.42, "y": 0.28, "w": 0.35, "h": 0.028 }
    }
  ],
  "formFields": [
    { "name": "ExactFormFieldName", "value": "Wert" }
  ],
  "notesForTeacher": "optionale didaktische Hinweise",
  "uncertainties": "falls Aufgaben unklar sind"
}`

export const SOLUTION_SYSTEM_PROMPT_LUECKENTEXT = `Du bist eine erfahrene deutsche Lehrkraft und erstellst Musterlösungen für Unterrichtsmaterialien.

Ziel: Die Antworten werden visuell in das Original-Arbeitsblatt geschrieben (PDF-Seiten bleiben erhalten, Text wird in die Lücken gelegt). Du lieferst strukturierte Antworten; die Platzierung nutzt blankIndex und den Textkontext links/rechts der Lücke.

Regeln:
- Antworte ausschließlich auf Deutsch.
- Gib ausschließlich ein JSON-Objekt zurück (kein Markdown drumherum, kein Einleitungstext).
- Schema:
${SOLUTION_JSON_SCHEMA}
- Nummeriere Antworten als „Lücke 1“, „Lücke 2“, … in exakt derselben Reihenfolge wie blankIndex (0 → Lücke 1).
- page: 1-basierte Seitenzahl, auf der die Lücke liegt.
- fieldType: "luecke" für kurze Einwort-/Phrasenantworten; "freitext" nur wenn die Aufgabe ausdrücklich Fließtext verlangt.
- Semantik zuerst: Jede answer muss im Satzkontext der konkreten Lücke grammatisch und fachlich passen (z. B. „Die ___ der Pflanze“ → „Wurzel“, nicht ein beliegiges anderes Wort).
- Wortliste / Candidate Bank:
  - Wenn im User-Prompt eine „Verbindliche Wortliste (Kandidaten)“ steht: Antworten AUSSCHLIESSLICH aus diesen Begriffen. Keine erfundenen Wörter.
  - Bei gleicher Anzahl von Kandidaten und Lücken: jeden Begriff GENAU einmal verwenden (bijektive Zuordnung).
  - Ohne verbindliche Liste: Antworten möglichst aus einer im Dokument sichtbaren Wortliste wählen.
- blankIndex:
  - Wenn eine maschinelle Lückenliste im User-Prompt steht: verwende GENAU diese Indizes (0…n-1). Keine eigenen Nummern erfinden, keine Lücke überspringen, keine Extra-Antworten ohne Lücke.
  - Sonst: Reihenfolge aller optischen Lücken im Dokument von oben nach unten, bei Gleichstand links nach rechts, beginnend bei 0.
  - Lücken sind: Unterstriche, Punktlinien, Antwortlinien, leere Kästen oder eindeutige Antwortplätze im Satz (nicht normaler Fließtext, nicht Material-/Infotexte).
- leftContext / rightContext: jeweils wenige Wörter unmittelbar vor bzw. nach der Lücke (wie in der Lückenliste bzw. im Dokument).
- bbox (Fallback, wenn keine Text-Lücken erkannt werden – z. B. Scans):
  - Normierte Koordinaten 0.0–1.0 relativ zur Seite.
  - Ursprung oben links (wie auf dem Seitenbild): x nach rechts, y nach unten.
  - x/y = obere linke Ecke der konkreten Lücke im Satz (nicht die Wortliste, nicht der Leerraum darüber/darunter).
  - w/h = Breite/Höhe der Lückenregion (Unterstrich/Lücke selbst).
  - Niemals Positionen in großen Weißflächen schätzen, die keine Lücke sind.
- answer: möglichst kurz und lückengerecht (Einzelwort, Zahl, kurzer Satz) – kein Aufsatz, außer die Aufgabe verlangt Fließtext. Nicht an die Reihenfolge der Wortliste kleben – ordne nach Satzkontext.
- formFields: nur bei echten PDF-/Word-Formularfeldern; "name" muss dem Feldnamen entsprechen, soweit erkennbar.
- Löse jede erkennbare Aufgabe. Überspringe keine Teilaufgabe.
- Formuliere fachlich korrekt und altersgerecht.
- Erfinde keine Inhalte, die dem Material widersprechen.`

export const SOLUTION_SYSTEM_PROMPT_OFFEN = `Du bist eine erfahrene deutsche Lehrkraft und erstellst Musterlösungen für Unterrichtsmaterialien.

Ziel: Das Material enthält KEINE auszufüllenden Lücken und keine Antwortfelder. Es handelt sich um offene Aufgaben (Beschreiben, Erklären, Erörtern, …). Die Musterlösung erscheint als separates Dokument mit Aufgabennummer und Lösungstext – nicht als Overlay auf dem Original.

Regeln:
- Antworte ausschließlich auf Deutsch.
- Gib ausschließlich ein JSON-Objekt zurück (kein Markdown drumherum, kein Einleitungstext).
- Schema:
${SOLUTION_JSON_SCHEMA}
- Nummeriere und benenne Antworten genau wie im Material (Aufgabe 1, a), …) – label = Aufgabennummer/Bezeichnung.
- page: 1-basierte Seitenzahl der Aufgabenstellung im Original (nur Hinweis, optional).
- fieldType: immer "freitext".
- blankIndex: immer null.
- leftContext / rightContext: immer null.
- bbox: immer null (kein Einzeichnen ins Original).
- answer: knapper Erwartungshorizont (Stichpunkte oder kurze Sätze), fachlich korrekt und altersgerecht – kein Roman.
- formFields: leer lassen, außer es gibt echte PDF-/Word-Formularfelder.
- Löse jede erkennbare Aufgabe. Überspringe keine Teilaufgabe.
- Erfinde keine Inhalte, die dem Material widersprechen.
- Behandle durchgehenden Sachtext, Materialien und Abbildungen NICHT als Lückentext.`

/** @deprecated Nutzen Sie solutionSystemPromptForMode – bleibt als Alias für Lückentext. */
export const SOLUTION_SYSTEM_PROMPT = SOLUTION_SYSTEM_PROMPT_LUECKENTEXT

export function resolveSolutionFillMode(context: SolutionPromptContext): SolutionFillMode {
  if (context.fillMode === 'lueckentext' || context.fillMode === 'offen') return context.fillMode
  return context.blankInventory?.trim() ? 'lueckentext' : 'offen'
}

export function solutionSystemPromptForMode(mode: SolutionFillMode): string {
  return mode === 'offen' ? SOLUTION_SYSTEM_PROMPT_OFFEN : SOLUTION_SYSTEM_PROMPT_LUECKENTEXT
}

export function buildSolutionPrompt(context: SolutionPromptContext): string {
  const mode = resolveSolutionFillMode(context)
  const lines: string[] = []

  if (mode === 'offen') {
    lines.push(
      'Erstelle eine Musterlösung (Erwartungshorizont) für das folgende Unterrichtsmaterial.',
      'Es wurden KEINE ausfüllbaren Dokumentlücken/Antwortfelder erkannt – offene Aufgabe.',
      'Die Lösung wird als separates PDF mit Aufgabennummer und Lösungstext erzeugt (kein Overlay).',
      'fieldType ist freitext; blankIndex, leftContext, rightContext und bbox sind null.',
    )
  } else {
    lines.push(
      'Erstelle eine ausfüllbare Musterlösung für das folgende Unterrichtsmaterial.',
      'Die Antworten werden maschinell in die Dokumentlücken geschrieben.',
      'Wichtig: Jede Antwort muss semantisch zum Satzkontext ihrer Lücke passen; blankIndex allein reicht nicht.',
    )
  }

  lines.push('', '## Angaben zum Material')
  lines.push(`- Titel: ${context.title}`)
  lines.push(`- Füllmodus: ${mode}`)

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

  if (mode === 'lueckentext' && context.candidateBank) {
    lines.push(
      '',
      '## Verbindliche Wortliste (Kandidaten)',
      formatCandidateBankForPrompt(context.candidateBank),
      context.candidateBank.reusePolicy === 'once'
        ? 'VERBINDLICH: ausschließlich diese Begriffe, jeden genau einmal.'
        : 'VERBINDLICH: ausschließlich diese Begriffe (Wiederholung nur wenn nötig).',
    )
  }

  if (mode === 'lueckentext' && context.blankInventory?.trim()) {
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

  lines.push('', 'Die beigefügten Dateien bzw. Seitenbilder zeigen das Material im Original.')

  if (mode === 'offen') {
    lines.push(
      'Erkenne Aufgabenstellungen multimodal. Materialtexte und GUIs sind Kontext, keine Lücken.',
      'Für jede Aufgabe: label (Aufgabennummer) + answer (Erwartungshorizont) + page + fieldType="freitext" + blankIndex=null + bbox=null.',
    )
  } else {
    lines.push(
      'Erkenne Aufgaben, Abbildungen, Lücken und Formularfelder multimodal.',
      context.blankInventory?.trim()
        ? 'Für jede erkannte Lücke: answer + page + blankIndex (aus der Liste) + leftContext + rightContext + fieldType + bbox.'
        : 'Für jede Lücke: answer + page + blankIndex (Dokumentreihenfolge) + leftContext + rightContext + fieldType + bbox (normiert 0–1, Ursprung oben links).',
    )
  }

  lines.push('Liefere ausschließlich das JSON-Objekt.')

  return lines.join('\n')
}

/** Kurzer Hinweis für das Inhaltsfeld / Dokumentkopf. */
export const AI_CONTENT_NOTICE =
  'Von künstlicher Intelligenz erstellt. Diese Musterlösung wurde automatisch generiert und ist fachlich noch nicht geprüft. Bitte vor dem Einsatz im Unterricht kontrollieren.'

/** Markdown-Variante für optionales Inhaltsfeld. */
export const AI_CONTENT_NOTICE_MD =
  '> **Von künstlicher Intelligenz erstellt.** Diese Musterlösung wurde automatisch generiert und ist fachlich noch nicht geprüft. Bitte vor dem Einsatz im Unterricht kontrollieren.'
