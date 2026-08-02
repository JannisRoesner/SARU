/**
 * Erkennt Aufgabentypen in Arbeitsblatt-Text (auch flache PDF-Textebene ohne Zeilenumbrüche).
 */

export type WorksheetTaskKind =
  | 'image_labeling'
  | 'glossary'
  | 'open_ended'
  | 'number_matching'

export interface WorksheetTaskUnit {
  kind: WorksheetTaskKind
  instruction: string
  /** Seite 1-basiert, geschätzt aus Textposition. */
  page: number
  yNorm: number
  confidence: number
  evidence: string[]
  /** Wortliste / Glossarbegriffe, falls extrahiert. */
  terms?: string[]
}

/** „Ordne … dem Bild zu:“ + Kommaliste großgeschriebener Begriffe. */
const IMAGE_LABELING =
  /ordn\w*.{0,100}(?:bild|abbildung|skizze|schema|zeichnung).{0,60}zu\s*:?\s*((?:[\p{Lu}][\p{L}\p{N}-]*)(?:\s*,\s*[\p{Lu}][\p{L}\p{N}-]*){1,12})/iu

const GLOSSARY =
  /vervollständig\w*\s+das\s+glossar|glossar\s*[„"']|begriff\s+bedeutung/i

const OPEN_OPERATOR =
  /\b(?:beschreib\w*|erklär\w*|erläuter\w*|erörter\w*|vergleich\w*|diskutier\w*|begründ\w*|nenn\w*|schreib\w*|recherchier\w*|beantwort\w*|stell(?:e|t)\s+dir\s+vor)\b/i

/** Teilt flachen PDF-Text in Aufgabeneinheiten (nicht an jedem „?“). */
export function splitWorksheetUnits(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return []

  // Aufgabenstarts + Seiten-/Glossar-Grenzen (PDF oft ohne Satzende vor „Vervollständige“).
  const parts = normalized.split(
    /(?:(?<=[.!?])\s+(?=(?:Ordne\b|Stelle dir vor\b|Welche\b|Worauf\b|Wenn\b|Vervollständige\b|Beschreibe\b|Erkläre\b|Erörtere\b))|\s+(?=Vervollständige\b)|\s+(?=Du bist kein Werwolf\b))/u,
  )

  const units: string[] = []
  for (const part of parts) {
    const trimmed = trimTrailingMeta(part.trim())
    if (trimmed.length >= 20) units.push(trimmed)
  }
  return units.length > 0 ? units : [normalized]
}

/** Entfernt angehängte Seitenköpfe / Glossar-Reste aus einer Aufgabeneinheit. */
function trimTrailingMeta(unit: string): string {
  return unit
    .replace(/\s+Du bist kein Werwolf[\s\S]*$/i, '')
    .replace(/\s+Vervollständige das Glossar[\s\S]*$/i, '')
    .replace(/\s+Begriff\s+Bedeutung[\s\S]*$/i, '')
    .replace(/\s+\d{2}_Arbeitsblatt:[\s\S]*$/i, '')
    .trim()
}

function isNoiseOpenUnit(unit: string): boolean {
  if (/^(?:du bist kein werwolf|©\s*wdr|\d{0,2}_?arbeitsblatt:)/i.test(unit)) {
    return true
  }
  if (/du bist kein werwolf|©\s*wdr|arbeitsblatt:/i.test(unit) && unit.length < 220) {
    return true
  }
  // Teaser vor „Bearbeite die Aufgaben“, keine eigene Teilaufgabe.
  if (/was passiert/i.test(unit) && /filmclip|schau/i.test(unit) && !/nenn|schreib|erklär/i.test(unit)) {
    return true
  }
  if (/^bearbeite\s+anschließend/i.test(unit)) return true
  return false
}

function estimatePage(unit: string, fullText: string): { page: number; yNorm: number } {
  const idx = fullText.indexOf(unit.slice(0, 40))
  if (idx < 0) return { page: 1, yNorm: 0.3 }
  const before = fullText.slice(0, idx)
  const pageBreaks = (before.match(/---PAGE\s+\d+---|Seite\s+\d+/gi) ?? []).length
  // Ohne Seitenmarker: Position im Text als grobe y-Schätzung (Seite 1).
  const ratio = fullText.length > 0 ? idx / fullText.length : 0
  // Wenn der Text „Glossar“ erst später kommt, oft Seite 2.
  const glossIdx = fullText.search(/glossar/i)
  if (glossIdx >= 0 && idx >= glossIdx) {
    return { page: 2, yNorm: Math.min(0.85, 0.15 + (idx - glossIdx) / Math.max(1, fullText.length - glossIdx) * 0.6) }
  }
  return {
    page: pageBreaks > 0 ? pageBreaks + 1 : ratio > 0.55 ? 2 : 1,
    yNorm: Math.min(0.9, 0.1 + ratio * 0.8),
  }
}

/** Extrahiert Komma-/Schrägstrich-Liste nach „… zu:“ / „Wortliste:“. */
export function extractInlineTermList(raw: string): string[] {
  const cleaned = raw
    .replace(/\s+/g, ' ')
    .replace(/\b(?:und|oder)\b/gi, ',')
    .trim()
  return cleaned
    .split(/[,;/|]/)
    .map((t) => t.trim().replace(/^[-•]\s*/, '').replace(/[.!?…]+$/, ''))
    .filter((t) => t.length >= 2 && t.length <= 48 && /[\p{L}]/u.test(t))
}

/**
 * Begriffe aus Glossar-Spalte (nach „Begriff Bedeutung“, vor Definitionen).
 */
export function extractGlossaryTerms(text: string): string[] {
  const m = text.match(
    /begriff\s+bedeutung\s+(.+?)(?=\s+Der\s+|\s+Die\s+|\s+Das\s+|\s+Ein\s+|\s*$)/is,
  )
  if (!m?.[1]) return []
  // „Leydig- Zwischenzellen“ → zusammenführen
  const chunk = m[1]
    .replace(/(\p{L})-\s+(\p{L})/gu, '$1-$2')
    .replace(/\s+/g, ' ')
    .trim()
  // Einzelne großgeschriebene Terme (ggf. mit Bindestrich)
  const terms = chunk.match(
    /(?:[\p{Lu}][\p{L}\p{N}-]*(?:-[\p{Lu}][\p{L}\p{N}-]*)*)/gu,
  )
  if (!terms) return []
  return [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 3))]
}

/** Bildbeschriftung mit Wortliste nach Doppelpunkt. */
export function detectImageLabelingTask(text: string): WorksheetTaskUnit | null {
  const m = text.match(IMAGE_LABELING)
  if (!m) return null
  const terms = extractInlineTermList(m[1] ?? '')
  if (terms.length < 2) return null
  const instruction = m[0].slice(0, 220).trim()
  const pos = estimatePage(instruction, text)
  return {
    kind: 'image_labeling',
    instruction,
    page: pos.page,
    yNorm: pos.yNorm,
    confidence: 0.9,
    evidence: ['image labeling with term list', `${terms.length} terms`],
    terms,
  }
}

/** Glossar-Vervollständigung. */
export function detectGlossaryTask(text: string): WorksheetTaskUnit | null {
  if (!GLOSSARY.test(text)) return null
  const terms = extractGlossaryTerms(text)
  const m = text.match(/vervollständig\w*\s+das\s+glossar[^.!?]{0,160}/i)
  const instruction =
    m?.[0]?.trim() ||
    'Vervollständige das Glossar (Begriff → Bedeutung).'
  const pos = estimatePage(instruction, text)
  return {
    kind: 'glossary',
    instruction: instruction.slice(0, 220),
    page: Math.max(pos.page, terms.length > 0 ? 2 : pos.page),
    yNorm: 0.25,
    confidence: terms.length >= 3 ? 0.92 : 0.8,
    evidence: [
      'glossary completion',
      terms.length > 0 ? `${terms.length} glossary terms` : 'glossary header',
    ],
    terms: terms.length >= 2 ? terms : undefined,
  }
}

/**
 * Offene Teilaufgaben (auch „Nenne“, „Erkläre“, „Warum …?“).
 * Überspringt reine Bildzuordnungs-/Glossar-Instruktionen.
 */
export function detectOpenEndedTaskUnits(text: string): WorksheetTaskUnit[] {
  const units = splitWorksheetUnits(text)
  const out: WorksheetTaskUnit[] = []
  let index = 0

  for (const unit of units) {
    if (IMAGE_LABELING.test(unit) && !OPEN_OPERATOR.test(unit) && !/\?/.test(unit)) {
      continue
    }
    if (/^vervollständig\w*\s+das\s+glossar/i.test(unit)) continue
    if (/^begriff\s+bedeutung/i.test(unit)) continue
    if (isNoiseOpenUnit(unit)) continue

    const hasOpenOp = OPEN_OPERATOR.test(unit)
    const hasQuestion = /\?/.test(unit)
    const hasWarumWelche = /\b(?:warum|welche|was\s+könnte|nenn\w*)\b/i.test(unit)
    if (!hasOpenOp && !hasQuestion && !hasWarumWelche) continue

    index += 1
    const pos = estimatePage(unit, text)
    out.push({
      kind: 'open_ended',
      instruction: unit.slice(0, 280),
      page: pos.page,
      yNorm: pos.yNorm,
      confidence: hasOpenOp ? 0.88 : 0.8,
      evidence: [
        hasOpenOp ? 'open-ended operator' : 'question mark / why-which',
        `unit ${index}`,
      ],
    })
  }

  return out
}

/** Alle erkannten Arbeitsblatt-Aufgaben (ohne Cloze-Lücken). */
export function detectWorksheetTasks(text: string): WorksheetTaskUnit[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  const tasks: WorksheetTaskUnit[] = []
  const labeling = detectImageLabelingTask(trimmed)
  if (labeling) tasks.push(labeling)

  const glossary = detectGlossaryTask(trimmed)
  if (glossary) tasks.push(glossary)

  tasks.push(...detectOpenEndedTaskUnits(trimmed))

  // Deduplizieren nach ähnlichem Instruktionsanfang
  const seen = new Set<string>()
  return tasks.filter((t) => {
    const key = `${t.kind}:${t.instruction.slice(0, 60).toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Kompakte Aufgabenliste für den Prompt. */
export function formatWorksheetTasksForPrompt(tasks: WorksheetTaskUnit[]): string {
  return tasks
    .map((t, i) => {
      const kindLabel =
        t.kind === 'image_labeling'
          ? 'Bildbeschriftung'
          : t.kind === 'glossary'
            ? 'Glossar'
            : t.kind === 'number_matching'
              ? 'Nummern-Zuordnung'
              : 'Offene Aufgabe'
      const terms =
        t.terms && t.terms.length
          ? `\n  Begriffe: ${t.terms.join(', ')}`
          : ''
      return `${i + 1}. [${kindLabel}] ${t.instruction}${terms}`
    })
    .join('\n')
}
