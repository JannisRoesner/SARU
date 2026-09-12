import type { MaterialType } from '#shared/types/domain'
import type { AiSettings } from '../settings.service'
import {
  filenameBasedMaterialSuggestion,
  guessMaterialType as sharedGuessMaterialType,
  suggestMaterialMetadata,
  titleFromFileName as sharedTitleFromFileName,
} from '../ai/suggest-material-metadata'
import type { BulkUploadFileSuggestion, BulkUploadMapping } from './types'

export const titleFromFileName = sharedTitleFromFileName
export const guessMaterialType = sharedGuessMaterialType

export function filenameBasedSuggestion(
  fileName: string,
  defaultMaterialType: MaterialType = 'arbeitsblatt',
): BulkUploadFileSuggestion {
  const base = filenameBasedMaterialSuggestion(fileName, defaultMaterialType)
  return toBulkSuggestion(base)
}

/**
 * Schlägt Metadaten vor. Nutzt extrahierten Text, sonst Dateiname und Paketkontext.
 */
export async function suggestFileMetadata(options: {
  fileName: string
  extractedText: string
  mapping: Pick<
    BulkUploadMapping,
    'defaultMaterialType' | 'subjectName' | 'gradeLevel' | 'schoolForm'
  >
  subjectLabel?: string | null
  extraContext?: string | null
  settings: AiSettings
}): Promise<BulkUploadFileSuggestion> {
  const result = await suggestMaterialMetadata({
    fileName: options.fileName,
    extractedText: options.extractedText,
    settings: options.settings,
    context: {
      subjectLabel: options.subjectLabel || options.mapping.subjectName,
      gradeLevel: options.mapping.gradeLevel,
      schoolForm: options.mapping.schoolForm,
      defaultMaterialType: options.mapping.defaultMaterialType ?? 'arbeitsblatt',
      lessonContext: options.extraContext,
    },
  })
  return toBulkSuggestion(result)
}

function toBulkSuggestion(
  result: Awaited<ReturnType<typeof suggestMaterialMetadata>>,
): BulkUploadFileSuggestion {
  return {
    title: result.title,
    materialType: result.materialType,
    subjectNames: result.subjectNames,
    tagNames: result.tagNames,
    description: result.description,
    learningObjectives: result.learningObjectives,
    contentSummary: result.contentSummary,
    schoolForm: result.schoolForm,
    aiUsed: result.aiUsed,
  }
}
