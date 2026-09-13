import {
  MATERIAL_TYPES,
  SCHOOL_FORMS,
  type MaterialType,
  type SchoolForm,
} from '#shared/types/domain'
import {
  gradeLevelsFromOberstufeHint,
  guessGradeLevelsFromFileName,
  mapLegacyOberstufeToCurrent,
  normalizeGradeLevel,
  normalizeGradeLevels,
  type GradeLevel,
} from '#shared/utils/jahrgangsstufen'
import {
  guessMaterialType,
  isBookLikeMaterialType,
  refineMaterialTypeForDocument,
} from '#shared/utils/material-type-guess'
import { materialTypes, schoolForms } from '#shared/utils/labels'
import {
  normalizeSchulfach,
  normalizeSchulfaecher,
  schulfaecherPromptListe,
} from '#shared/utils/schulfaecher'
import { chatCompletion } from './client'
import type { AiSettings } from '../settings.service'
import { extractJsonObject } from '../../utils/json-parse'
import { createLogger } from '../../utils/logger'

const log = createLogger('ai:suggest-metadata')

const MATERIAL_TYPE_SET = new Set<string>(MATERIAL_TYPES)
const SCHOOL_FORM_SET = new Set<string>(SCHOOL_FORMS)

export const MATERIAL_METADATA_PROMPT_VERSION = 'material-metadata-v7'

export interface MaterialMetadataSuggestion {
  title: string
  materialType: MaterialType
  schoolForm: SchoolForm | null
  /** Erkannte Schulfächer (hessische Orientierungsliste). */
  subjectNames: string[]
  tagNames: string[]
  learningObjectives: string[]
  description: string
  /** Kurze Markdown-Zusammenfassung für materials.content */
  contentSummary: string
  /** Erkannte Jahrgangsstufen (1–10 oder E1/E2/Q1–Q4). */
  gradeLevels: GradeLevel[]
  aiUsed: boolean
}

export interface SuggestMaterialMetadataOptions {
  fileName: string
  extractedText: string
  settings: AiSettings
  context?: {
    subjectLabel?: string | null
    gradeLevel?: number | string | null
    schoolForm?: string | null
    defaultMaterialType?: MaterialType
    pageCount?: number | null
    /** Zusätzlicher Freitext, z. B. Schulportal-Thema/Inhalt der Stunde */
    lessonContext?: string | null
  }
}

export function titleFromFileName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export { guessMaterialType }

export function filenameBasedMaterialSuggestion(
  fileName: string,
  defaultMaterialType: MaterialType = 'arbeitsblatt',
): MaterialMetadataSuggestion {
  return {
    title: titleFromFileName(fileName) || fileName,
    materialType: guessMaterialType(fileName, defaultMaterialType),
    schoolForm: null,
    subjectNames: [],
    tagNames: [],
    learningObjectives: [],
    description: '',
    contentSummary: '',
    gradeLevels: guessGradeLevelsFromFileName(fileName),
    aiUsed: false,
  }
}

/**
 * Schlägt Metadaten und eine Inhaltszusammenfassung vor.
 * Nutzt den bereits extrahierten Text (Textebene oder Vision) – kein erneutes OCR.
 */
export async function suggestMaterialMetadata(
  options: SuggestMaterialMetadataOptions,
): Promise<MaterialMetadataSuggestion> {
  const fallback = filenameBasedMaterialSuggestion(
    options.fileName,
    options.context?.defaultMaterialType ?? 'arbeitsblatt',
  )

  if (!options.settings.enabled || !options.settings.chatModel) {
    return applyTypeRefinement(fallback, options)
  }

  const text = options.extractedText.trim()

  const typeList = MATERIAL_TYPES.map((t) => `${t} (${materialTypes.label(t)})`).join(', ')
  const schoolList = SCHOOL_FORMS.map((s) => `${s} (${schoolForms.label(s)})`).join(', ')
  const ctx = options.context ?? {}
  const contextParts = [
    ctx.subjectLabel ? `Fach: ${ctx.subjectLabel}` : null,
    ctx.gradeLevel != null && ctx.gradeLevel !== '' ? `Jahrgang: ${ctx.gradeLevel}` : null,
    ctx.schoolForm ? `Schulform: ${ctx.schoolForm}` : null,
    `Standard-Materialart: ${fallback.materialType}`,
    ctx.lessonContext?.trim()
      ? `Unterrichtskontext: ${ctx.lessonContext.trim().slice(0, 1500)}`
      : null,
  ].filter(Boolean)

  const fachListe = schulfaecherPromptListe()
  const excerpt = text
    ? text.slice(0, 8000)
    : '(kein Dokumenttext – Titel, Dateiname und Kontext nutzen)'
  const buchArt =
    ctx.defaultMaterialType && isBookLikeMaterialType(ctx.defaultMaterialType)
      ? ctx.defaultMaterialType
      : isBookLikeMaterialType(fallback.materialType)
        ? fallback.materialType
        : null
  const prompt =
    buchArt === 'lehrwerk'
      ? buildLehrwerkMetadataPrompt({
          fileName: options.fileName,
          contextParts,
          schoolList,
          fachListe,
          excerpt,
        })
      : buchArt
        ? buildBegleitbandMetadataPrompt({
            fileName: options.fileName,
            contextParts,
            schoolList,
            fachListe,
            excerpt,
            materialType: buchArt,
          })
        : buildMaterialMetadataPrompt({
            fileName: options.fileName,
            contextParts,
            typeList,
            schoolList,
            fachListe,
            excerpt,
          })

  const maxTokens = Math.min(Math.max(options.settings.maxOutputTokens || 800, 400), 800)

  let lastError: unknown
  let lastRawResponse = ''
  let lastOutputTokens: number | undefined

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await chatCompletion(
        options.settings,
        [
          {
            role: 'system',
            parts: [
              {
                type: 'text',
                text:
                  'Du antwortest ausschließlich mit einem gültigen JSON-Objekt. Kein Markdown, kein Fließtext davor oder danach.',
              },
            ],
          },
          { role: 'user', parts: [{ type: 'text', text: prompt }] },
        ],
        { temperature: 0.1, maxOutputTokens: maxTokens, jsonMode: true },
      )

      lastRawResponse = result.text
      lastOutputTokens = result.outputTokens

      const parsed = extractJsonObject(result.text)
      if (!parsed) {
        if (attempt === 0) {
          log.warn('KI-Metadaten: ungültige JSON-Antwort, wiederhole …', {
            fileName: options.fileName,
            antwortLaenge: result.text.length,
            outputTokens: result.outputTokens,
            antwortVorschau: result.text.slice(0, 400),
          })
          await pause(1500)
          continue
        }
        log.warn('KI-Metadaten: JSON konnte nicht gelesen werden', {
          fileName: options.fileName,
          antwortLaenge: result.text.length,
          outputTokens: result.outputTokens,
          antwortVorschau: result.text.slice(0, 600),
        })
        return fallback
      }

      const title =
        typeof parsed.title === 'string' && parsed.title.trim()
          ? parsed.title.trim().slice(0, 300)
          : fallback.title

      const subjectNames = mergeSubjectNames(
        normalizeSchulfaecher(parsed.subjectNames),
        ctx.subjectLabel,
      )

      return applyTypeRefinement({
        title,
        materialType:
          ctx.defaultMaterialType && isBookLikeMaterialType(ctx.defaultMaterialType)
            ? ctx.defaultMaterialType
            : normalizeMaterialType(parsed.materialType, fallback.materialType),
        schoolForm: normalizeSchoolForm(parsed.schoolForm, ctx.schoolForm),
        subjectNames,
        tagNames: normalizeStringList(parsed.tagNames, 8),
        learningObjectives: normalizeStringList(parsed.learningObjectives, 6),
        description:
          typeof parsed.description === 'string'
            ? parsed.description.trim().slice(0, 2000)
            : '',
        contentSummary:
          typeof parsed.contentSummary === 'string'
            ? parsed.contentSummary.trim().slice(0, 8000)
            : '',
        gradeLevels: resolveSuggestedGradeLevels(
          parsed.gradeLevels,
          options.fileName,
          ctx.gradeLevel,
          [title, typeof parsed.description === 'string' ? parsed.description : ''].join(' '),
        ),
        aiUsed: true,
      }, options)
    } catch (error) {
      lastError = error
      if (attempt === 0) {
        log.warn('KI-Metadaten-Vorschlag fehlgeschlagen, wiederhole …', {
          fileName: options.fileName,
          error,
        })
        await pause(2000)
        continue
      }
    }
  }

  log.warn('KI-Metadaten-Vorschlag endgültig fehlgeschlagen, Dateiname wird verwendet', {
    fileName: options.fileName,
    error: lastError,
    antwortLaenge: lastRawResponse.length,
    outputTokens: lastOutputTokens,
    antwortVorschau: lastRawResponse.slice(0, 600),
  })
  return applyTypeRefinement(fallback, options)
}

function applyTypeRefinement(
  suggestion: MaterialMetadataSuggestion,
  options: SuggestMaterialMetadataOptions,
): MaterialMetadataSuggestion {
  return {
    ...suggestion,
    materialType: refineMaterialTypeForDocument({
      fileName: options.fileName,
      current: suggestion.materialType,
      pageCount: options.context?.pageCount,
      excerpt: options.extractedText,
      defaultMaterialType: options.context?.defaultMaterialType,
    }),
  }
}

/**
 * Eine knappe Inhaltsbeschreibung – für Reihen, Musterlösungen und ähnliche Fälle
 * ohne vollständiges Material-JSON.
 */
export async function suggestShortDescription(options: {
  title: string
  context: string
  settings: AiSettings
}): Promise<string | null> {
  if (!options.settings.enabled || !options.settings.chatModel) return null
  const title = options.title.trim()
  const context = options.context.trim().slice(0, 6000)
  if (!title && !context) return null

  try {
    const result = await chatCompletion(
      options.settings,
      [
        {
          role: 'system',
          parts: [
            {
              type: 'text',
              text: 'Du antwortest ausschließlich mit einem gültigen JSON-Objekt.',
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              type: 'text',
              text: `Schreibe eine knappe deutsche Kurzbeschreibung (1–2 Sätze) für Unterrichtsmaterial.

Titel: ${title || '–'}
Kontext:
${context || '(nur Titel)'}

Regeln:
- Nur den fachlichen Inhalt beschreiben.
- Keine Herkunfts- oder Prozessfloskeln (nicht: importiert, Schulportal, KI-Entwurf, automatisch erstellt, manuell geprüft).
- Kein Markdown.

Antworte ausschließlich mit JSON: {"description":"..."}`,
            },
          ],
        },
      ],
      {
        temperature: 0.1,
        maxOutputTokens: Math.min(Math.max(options.settings.maxOutputTokens || 400, 400), 800),
        jsonMode: true,
      },
    )

    const parsed = extractJsonObject(result.text)
    const description =
      typeof parsed?.description === 'string' ? parsed.description.replace(/\s+/g, ' ').trim() : ''
    return description ? description.slice(0, 2000) : null
  } catch (error) {
    log.warn('Kurzbeschreibung per KI fehlgeschlagen', { title, error })
    return null
  }
}

const GRADE_LEVEL_RULES = `Regeln für gradeLevels:
- Nur gültige Stufen: ganze Zahlen 1–10 oder hessische Oberstufen-Codes E1, E2, Q1, Q2, Q3, Q4. Keine 11/12/13.
- Hessische gymnasiale Oberstufe:
  - E1, E2 = Einführungsphase (E-Phase; oft Jahrgang 11, 1. und 2. Halbjahr).
  - Q1, Q2, Q3, Q4 = Qualifikationsphase (Q-Phase; oft Jahrgänge 12 und 13).
- Steht nur „Einführungsphase“ / „E-Phase“ ohne Halbjahr: E1 und E2.
- Steht nur „Qualifikationsphase“ / „Q-Phase“ ohne Halbjahr: Q1, Q2, Q3 und Q4.
- Klasse 11 ≈ E-Phase, Klasse 12 ≈ Q1/Q2, Klasse 13 ≈ Q3/Q4.
- „Oberstufe“ allein reicht nicht, außer ein Lehrwerk deckt erkennbar die ganze gymnasiale Oberstufe ab – dann E1–Q4.
- Das genaue Halbjahr (E1 vs. E2, Q2 vs. Q3) nur setzen, wenn es explizit vorkommt. Sonst die ganze Phase, nicht raten.
- Nutze Hinweise aus Dateiname, Einband und Text (z. B. „Klasse 8“, „Bio 8“, „E1“, „Q2“, „Einführungsphase“).
- Keine Schuljahre wie 2024, keine Kapitel- oder Seitenzahlen.
- Fehlt jeder belastbare Hinweis: leeres Array.`

function buildMaterialMetadataPrompt(input: {
  fileName: string
  contextParts: string[]
  typeList: string
  schoolList: string
  fachListe: string
  excerpt: string
}): string {
  return `Du hilfst einer Lehrkraft in Hessen, Metadaten und eine kurze Zusammenfassung für Unterrichtsmaterial vorzuschlagen.

Dateiname: ${input.fileName}
${input.contextParts.length ? `Kontext: ${input.contextParts.join(' · ')}` : ''}

Erlaubte materialType-Werte (genau einen verwenden): ${input.typeList}
Erlaubte schoolForm-Werte (einen oder null): ${input.schoolList}

Schulfächer (nur aus dieser Liste wählen – keine Unterrichtsthemen, keine Detailgebiete):
${input.fachListe}

Regeln für subjectNames:
- Nur echte Schulfächer aus der obigen Liste (z. B. „Informatik“, „Biologie“, „Deutsch“).
- Keine Themen, Kapitel oder Methoden (z. B. NICHT „Objektorientierung“, „Photosynthese“, „Bruchrechnung“).
- Solche Inhalte gehören in tagNames oder learningObjectives.
- Typisch 1 Fach, höchstens 2 bei klarer fächerübergreifender Zuordnung.
- Bei Unsicherheit lieber leeres Array als raten.

Regeln für title und description:
- title: klarer deutscher Titel, keine Dateiendung, keine kryptischen Verlags-IDs wenn der Inhalt erkennbar ist.
- description: 1–2 Sätze zum fachlichen Inhalt.
- Keine Herkunfts- oder Prozessfloskeln (nicht: importiert, Schulportal, KI-Entwurf, automatisch erstellt, manuell geprüft).

Regeln für materialType bei Büchern vs. Arbeitsblättern:
- arbeitsblatt / kopiervorlage: wenige Seiten, einzelne Aufgaben, oft „AB“, „Kopiervorlage“.
- lehrwerk: Schülerbuch / Schulbuch (Schülerband) – Einband, Impressum, Inhaltsverzeichnis.
- serviceband: Serviceband, Lehrerband, Lehrerhandbuch, Handreichungen zum Lehrwerk – Hinweise für die Lehrkraft, kein Schülerarbeitsblatt.
- loesungsbuch: Lösungsheft oder Lösungsbuch zum Schülerbuch.
- Ein dickes Verlags-PDF mit Einband und Inhaltsverzeichnis ist kein Arbeitsblatt.

${GRADE_LEVEL_RULES}

Auszug aus dem Dokument:
"""
${input.excerpt}
"""

Antworte ausschließlich mit einem JSON-Objekt (kein Markdown):
{
  "title": "kurzer, klarer deutscher Titel ohne Dateiendung",
  "materialType": "einer der erlaubten Werte",
  "schoolForm": "einer der erlaubten Werte oder null",
  "subjectNames": ["max. 2 exakte Namen aus der Schulfächer-Liste"],
  "tagNames": ["max. 5 kurze Schlagwörter zu Inhalten/Themen"],
  "learningObjectives": ["max. 4 kurze Lernziele auf Deutsch"],
  "description": "1–2 Sätze Kurzbeschreibung auf Deutsch",
  "contentSummary": "Kurze Markdown-Zusammenfassung (max. 4 Sätze oder Stichpunkte) – keine Volltext-Abschrift",
  "gradeLevels": []
}`
}

function buildLehrwerkMetadataPrompt(input: {
  fileName: string
  contextParts: string[]
  schoolList: string
  fachListe: string
  excerpt: string
}): string {
  return `Du hilfst einer Lehrkraft in Hessen, ein Schulbuch (Schülerband / Lehrwerk) zu katalogisieren – kein Arbeitsblatt und kein einzelnes Kapitel.

Dateiname: ${input.fileName}
${input.contextParts.length ? `Kontext: ${input.contextParts.join(' · ')}` : ''}

materialType muss genau "lehrwerk" sein.
Erlaubte schoolForm-Werte (einen oder null): ${input.schoolList}

Schulfächer (nur aus dieser Liste wählen):
${input.fachListe}

Das Dokument ist ein ganzes Schulbuch. Typisch stehen vorn:
- Einband / Titelseite: Reihentitel, Band, Fach, Verlag, Jahrgang (z. B. „Natura Biologie Oberstufe Einführungsphase“)
- Impressum
- Inhaltsverzeichnis mit den Kapiteln des Bandes

Regeln für title:
- Nimm den Werktitel vom Einband oder der Titelseite (Reihe + Band/Stufe, z. B. „Natura Oberstufe Einführungsphase“).
- Kein Kapitel-, Themen- oder Lektionstitel (nicht „Bakterien“, nicht „Die Zelle“, nicht „Kapitel 3“).
- Keine Dateiendung, kein „komplett“, kein Scan-Zusatz. Der Dateiname darf nur stützen, wenn er zum Einband passt.

Regeln für description und contentSummary:
- description: 1–2 Sätze über das Buch als Ganzes (Reihe, Fach, Stufe, Verlag falls erkennbar).
- contentSummary: Überblick aus dem Inhaltsverzeichnis als kurze Markdown-Stichpunkte der Hauptkapitel – nicht den Text eines einzelnen Kapitels nacherzählen.
- Keine Herkunfts- oder Prozessfloskeln (nicht: importiert, KI-Entwurf, automatisch erstellt).

Regeln für subjectNames, tagNames, learningObjectives:
- subjectNames: nur das Schulfach des Werks (meist 1).
- tagNames: Reihe, Stufe oder grobe Themenblöcke aus dem Inhaltsverzeichnis – keine einzelnen Unterkapitel.
- learningObjectives: leer lassen oder höchstens 2 buchweite Ziele, keine Kapitelziele.

${GRADE_LEVEL_RULES}

Auszug aus dem vorderen Teil des Buchs:
"""
${input.excerpt}
"""

Antworte ausschließlich mit einem JSON-Objekt (kein Markdown):
{
  "title": "Werktitel vom Einband, ohne Kapitelname",
  "materialType": "lehrwerk",
  "schoolForm": "einer der erlaubten Werte oder null",
  "subjectNames": ["max. 2 exakte Namen aus der Schulfächer-Liste"],
  "tagNames": ["max. 5 Schlagwörter zur Reihe oder zu großen Themenblöcken"],
  "learningObjectives": [],
  "description": "1–2 Sätze über das Schulbuch als Ganzes",
  "contentSummary": "Markdown-Stichpunkte der Hauptkapitel aus dem Inhaltsverzeichnis",
  "gradeLevels": []
}`
}

function buildBegleitbandMetadataPrompt(input: {
  fileName: string
  contextParts: string[]
  schoolList: string
  fachListe: string
  excerpt: string
  materialType: 'serviceband' | 'loesungsbuch'
}): string {
  const art =
    input.materialType === 'serviceband'
      ? 'Serviceband / Lehrerband / Lehrerhandreichung zum Lehrwerk – kein Schülerbuch und kein Arbeitsblatt'
      : 'Lösungsheft / Lösungsbuch zum Schülerbuch – keine einzelne Musterlösung eines Arbeitsblatts'
  return `Du hilfst einer Lehrkraft in Hessen, ein Verlagsbuch zu katalogisieren (${art}).

Dateiname: ${input.fileName}
${input.contextParts.length ? `Kontext: ${input.contextParts.join(' · ')}` : ''}

materialType muss genau "${input.materialType}" sein.
Erlaubte schoolForm-Werte (einen oder null): ${input.schoolList}

Schulfächer (nur aus dieser Liste wählen):
${input.fachListe}

Typisch stehen vorn Einband / Titelseite, Impressum und Inhaltsverzeichnis.

Regeln für title:
- Nimm den Werktitel vom Einband (Reihe + Band + „Serviceband“ bzw. „Lösungsheft“, falls auf dem Einband).
- Kein Kapitel- oder Lektionstitel.
- Keine Dateiendung, kein Scan-Zusatz.

Regeln für description und contentSummary:
- description: 1–2 Sätze über das Buch als Ganzes.
- contentSummary: Überblick aus dem Inhaltsverzeichnis als kurze Markdown-Stichpunkte.
- Keine Herkunfts- oder Prozessfloskeln.

Regeln für subjectNames, tagNames, learningObjectives:
- subjectNames: nur das Schulfach (meist 1).
- tagNames: Reihe, Stufe oder grobe Themenblöcke.
- learningObjectives: leer lassen.

${GRADE_LEVEL_RULES}

Auszug aus dem vorderen Teil des Buchs:
"""
${input.excerpt}
"""

Antworte ausschließlich mit einem JSON-Objekt (kein Markdown):
{
  "title": "Werktitel vom Einband",
  "materialType": "${input.materialType}",
  "schoolForm": "einer der erlaubten Werte oder null",
  "subjectNames": ["max. 2 exakte Namen aus der Schulfächer-Liste"],
  "tagNames": ["max. 5 Schlagwörter zur Reihe oder zu großen Themenblöcken"],
  "learningObjectives": [],
  "description": "1–2 Sätze über das Buch als Ganzes",
  "contentSummary": "Markdown-Stichpunkte der Hauptkapitel aus dem Inhaltsverzeichnis",
  "gradeLevels": []
}`
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function mergeSubjectNames(
  fromAi: string[],
  contextLabel?: string | null,
): string[] {
  const result = [...fromAi]
  const seen = new Set(result.map((s) => s.toLowerCase()))
  const fromContext = contextLabel ? normalizeSchulfach(contextLabel) : null
  if (fromContext && !seen.has(fromContext.toLowerCase())) {
    result.unshift(fromContext)
  }
  return result.slice(0, 3)
}

function normalizeMaterialType(value: unknown, fallback: MaterialType): MaterialType {
  if (typeof value !== 'string') return fallback
  const key = value.trim().toLowerCase()
  if (MATERIAL_TYPE_SET.has(key)) return key as MaterialType
  const byLabel = MATERIAL_TYPES.find(
    (t) => materialTypes.label(t).toLowerCase() === key,
  )
  return byLabel ?? fallback
}

function normalizeSchoolForm(
  value: unknown,
  mappingFallback?: string | null,
): SchoolForm | null {
  if (typeof value === 'string') {
    const key = value.trim().toLowerCase()
    if (SCHOOL_FORM_SET.has(key)) return key as SchoolForm
    const byLabel = SCHOOL_FORMS.find(
      (s) => schoolForms.label(s).toLowerCase() === key,
    )
    if (byLabel) return byLabel
  }
  if (mappingFallback && SCHOOL_FORM_SET.has(mappingFallback)) {
    return mappingFallback as SchoolForm
  }
  return null
}

function normalizeStringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, max)
}

function parseGradeLevelTokens(value: unknown): GradeLevel[] {
  const direct = normalizeGradeLevel(value)
  if (direct) return mapLegacyOberstufeToCurrent(direct)
  if (typeof value !== 'string') return []

  const fromPhase = gradeLevelsFromOberstufeHint(value)
  if (fromPhase.length) return fromPhase

  const match = value
    .trim()
    .match(/^(?:klasse|jgst\.?|jg\.?)?\s*(\d{1,2}|e[12]|q[1-4])(?:\.\s*(?:klasse|jgst\.?|jg\.?))?$/i)
  if (!match?.[1]) return []
  const normalized = normalizeGradeLevel(match[1].replace(/^0+(\d{1,2})$/, '$1'))
  return normalized ? mapLegacyOberstufeToCurrent(normalized) : []
}

function resolveSuggestedGradeLevels(
  fromAi: unknown,
  fileName: string,
  contextGrade?: number | string | null,
  extraText?: string,
): GradeLevel[] {
  const items = Array.isArray(fromAi)
    ? fromAi
    : fromAi == null || fromAi === ''
      ? []
      : [fromAi]
  const parsed = normalizeGradeLevels(items.flatMap(parseGradeLevelTokens))
  if (parsed.length) return parsed

  if (contextGrade != null && contextGrade !== '') {
    const fromContext = normalizeGradeLevels(
      parseGradeLevelTokens(contextGrade),
    )
    if (fromContext.length) return fromContext
  }

  if (extraText?.trim()) {
    const fromText = gradeLevelsFromOberstufeHint(extraText)
    if (fromText.length) return fromText
  }

  return guessGradeLevelsFromFileName(fileName)
}
