import { MATERIAL_TYPES, type MaterialType } from '#shared/types/domain'
import { materialTypes } from '#shared/utils/labels'
import { chatCompletion } from '../ai/client'
import type { AiSettings } from '../settings.service'
import { createLogger } from '../../utils/logger'
import type { BulkUploadFileSuggestion, BulkUploadMapping } from './types'

const log = createLogger('bulk-upload:ai')

const MATERIAL_TYPE_SET = new Set<string>(MATERIAL_TYPES)

export function titleFromFileName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Grobe Einordnung anhand des Dateinamens – vom Nutzer jederzeit änderbar. */
export function guessMaterialType(fileName: string, fallback: MaterialType = 'arbeitsblatt'): MaterialType {
  const name = fileName.toLowerCase()
  if (/(l(ö|oe)sung|-lsg|_lsg)/.test(name)) return 'musterloesung'
  if (/(klausur|klassenarbeit)/.test(name)) return 'klausur'
  if (/(lernkontrolle|test|quiz)/.test(name)) return 'lernkontrolle'
  if (/(steckbrief|vorlage|^ab[-_ ]|arbeitsblatt)/.test(name)) return 'arbeitsblatt'
  if (/(elternbrief|brief|einverst(ä|ae)ndnis)/.test(name)) return 'sonstiges'
  if (/(praesentation|präsentation|folien)/.test(name)) return 'praesentation'
  return fallback
}

export function filenameBasedSuggestion(
  fileName: string,
  defaultMaterialType: MaterialType = 'arbeitsblatt',
): BulkUploadFileSuggestion {
  return {
    title: titleFromFileName(fileName) || fileName,
    materialType: guessMaterialType(fileName, defaultMaterialType),
    tagNames: [],
    description: '',
    aiUsed: false,
  }
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

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 8)
}

/**
 * Schlägt Metadaten vor. Nutzt bevorzugt den extrahierten Text;
 * ohne Text oder bei deaktivierter KI greift der Dateiname.
 */
export async function suggestFileMetadata(options: {
  fileName: string
  extractedText: string
  mapping: Pick<BulkUploadMapping, 'defaultMaterialType' | 'subjectName' | 'gradeLevel' | 'schoolForm'>
  subjectLabel?: string | null
  settings: AiSettings
}): Promise<BulkUploadFileSuggestion> {
  const fallback = filenameBasedSuggestion(
    options.fileName,
    options.mapping.defaultMaterialType ?? 'arbeitsblatt',
  )

  if (!options.settings.enabled || !options.settings.chatModel) {
    return fallback
  }

  const text = options.extractedText.trim()
  if (!text) {
    return {
      ...fallback,
      description: '',
      aiUsed: false,
    }
  }

  const typeList = MATERIAL_TYPES.map((t) => `${t} (${materialTypes.label(t)})`).join(', ')
  const contextParts = [
    options.subjectLabel || options.mapping.subjectName
      ? `Fach: ${options.subjectLabel || options.mapping.subjectName}`
      : null,
    options.mapping.gradeLevel != null ? `Jahrgang: ${options.mapping.gradeLevel}` : null,
    options.mapping.schoolForm ? `Schulform: ${options.mapping.schoolForm}` : null,
    `Standard-Materialart: ${fallback.materialType}`,
  ].filter(Boolean)

  const prompt = `Du hilfst einer Lehrkraft in Deutschland, Metadaten für Unterrichtsmaterial vorzuschlagen.

Dateiname: ${options.fileName}
${contextParts.length ? `Kontext: ${contextParts.join(' · ')}` : ''}

Erlaubte materialType-Werte (genau einen verwenden): ${typeList}

Auszug aus dem Dokument:
"""
${text.slice(0, 6000)}
"""

Antworte ausschließlich mit einem JSON-Objekt (kein Markdown):
{
  "title": "kurzer, klarer deutscher Titel ohne Dateiendung",
  "materialType": "einer der erlaubten Werte",
  "tagNames": ["max. 5 kurze Schlagwörter"],
  "description": "1–2 Sätze Kurzbeschreibung auf Deutsch"
}`

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
      { temperature: 0.2, maxOutputTokens: 500 },
    )

    const parsed = extractJsonObject(result.text)
    if (!parsed) return fallback

    const title =
      typeof parsed.title === 'string' && parsed.title.trim()
        ? parsed.title.trim().slice(0, 300)
        : fallback.title

    return {
      title,
      materialType: normalizeMaterialType(parsed.materialType, fallback.materialType),
      tagNames: normalizeTags(parsed.tagNames),
      description:
        typeof parsed.description === 'string' ? parsed.description.trim().slice(0, 2000) : '',
      aiUsed: true,
    }
  } catch (error) {
    log.warn('KI-Vorschlag fehlgeschlagen, Dateiname wird verwendet', {
      fileName: options.fileName,
      error,
    })
    return fallback
  }
}
