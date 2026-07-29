import {
  MATERIAL_TYPES,
  SCHOOL_FORMS,
  type MaterialType,
  type SchoolForm,
} from '#shared/types/domain'
import { materialTypes, schoolForms } from '#shared/utils/labels'
import {
  normalizeSchulfach,
  normalizeSchulfaecher,
  schulfaecherPromptListe,
} from '#shared/utils/schulfaecher'
import { chatCompletion } from './client'
import type { AiSettings } from '../settings.service'
import { createLogger } from '../../utils/logger'

const log = createLogger('ai:suggest-metadata')

const MATERIAL_TYPE_SET = new Set<string>(MATERIAL_TYPES)
const SCHOOL_FORM_SET = new Set<string>(SCHOOL_FORMS)

export const MATERIAL_METADATA_PROMPT_VERSION = 'material-metadata-v2'

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

/** Grobe Einordnung anhand des Dateinamens – vom Nutzer jederzeit änderbar. */
export function guessMaterialType(
  fileName: string,
  fallback: MaterialType = 'arbeitsblatt',
): MaterialType {
  const name = fileName.toLowerCase()
  if (/(l(ö|oe)sung|-lsg|_lsg)/.test(name)) return 'musterloesung'
  if (/(klausur|klassenarbeit)/.test(name)) return 'klausur'
  if (/(lernkontrolle|test|quiz)/.test(name)) return 'lernkontrolle'
  if (/(steckbrief|vorlage|^ab[-_ ]|arbeitsblatt)/.test(name)) return 'arbeitsblatt'
  if (/\.(png|jpe?g|gif|webp|avif)$/.test(name)) return 'bild'
  if (/\.(mp4|webm|mov)$/.test(name)) return 'video'
  if (/(praesentation|präsentation|folien)/.test(name) || /\.(pptx?|odp)$/.test(name)) {
    return 'praesentation'
  }
  if (/(elternbrief|brief|einverst(ä|ae)ndnis)/.test(name)) return 'sonstiges'
  return fallback
}

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
    return fallback
  }

  const text = options.extractedText.trim()
  if (!text) {
    return fallback
  }

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
  const prompt = `Du hilfst einer Lehrkraft in Hessen, Metadaten und eine kurze Zusammenfassung für Unterrichtsmaterial vorzuschlagen.

Dateiname: ${options.fileName}
${contextParts.length ? `Kontext: ${contextParts.join(' · ')}` : ''}

Erlaubte materialType-Werte (genau einen verwenden): ${typeList}
Erlaubte schoolForm-Werte (einen oder null): ${schoolList}

Schulfächer (nur aus dieser Liste wählen – keine Unterrichtsthemen, keine Detailgebiete):
${fachListe}

Regeln für subjectNames:
- Nur echte Schulfächer aus der obigen Liste (z. B. „Informatik“, „Biologie“, „Deutsch“).
- Keine Themen, Kapitel oder Methoden (z. B. NICHT „Objektorientierung“, „Photosynthese“, „Bruchrechnung“).
- Solche Inhalte gehören in tagNames oder learningObjectives.
- Typisch 1 Fach, höchstens 2 bei klarer fächerübergreifender Zuordnung.
- Bei Unsicherheit lieber leeres Array als raten.

Auszug aus dem Dokument:
"""
${text.slice(0, 8000)}
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
  "contentSummary": "Markdown-Zusammenfassung (3–8 Sätze oder Stichpunkte) des Inhalts – keine Volltext-Abschrift"
}`

  let lastError: unknown
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
                text: 'Du antwortest nur mit gültigem JSON ohne Erklärungstext.',
              },
            ],
          },
          { role: 'user', parts: [{ type: 'text', text: prompt }] },
        ],
        { temperature: 0.2, maxOutputTokens: 1200 },
      )

      const parsed = extractJsonObject(result.text)
      if (!parsed) {
        if (attempt === 0) {
          log.warn('KI-Metadaten: ungültige JSON-Antwort, wiederhole …', {
            fileName: options.fileName,
          })
          await pause(1500)
          continue
        }
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

      return {
        title,
        materialType: normalizeMaterialType(parsed.materialType, fallback.materialType),
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
        aiUsed: true,
      }
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
  })
  return fallback
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

function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
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
