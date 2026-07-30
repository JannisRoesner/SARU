import { readFile } from 'node:fs/promises'
import { eq, sql } from 'drizzle-orm'
import type { GradeLevel } from '#shared/utils/jahrgangsstufen'
import type { MaterialType, SchoolForm } from '#shared/types/domain'
import { useDatabase } from '../../database/client'
import { importRuns } from '../../database/schema'
import { appError, invalidInput, notFound } from '../../utils/errors'
import { sha256 } from '../../utils/crypto'
import { createLogger } from '../../utils/logger'
import {
  ensureExtractedText,
  readExtractedTextSidecar,
  storeExtractedTextSidecar,
  type ExtractionMethod,
} from './document-text'
import {
  MATERIAL_METADATA_PROMPT_VERSION,
  suggestMaterialMetadata,
  type MaterialMetadataSuggestion,
} from './suggest-material-metadata'
import { isExtractable } from '../extraction.service'
import { addFileAsset, createMaterial } from '../material.service'
import { getAiSettings } from '../settings.service'
import {
  deleteFile,
  extensionOf,
  resolveStoragePath,
  sanitizeFileName,
  storeStagingFile,
  validateUpload,
} from '../storage.service'
import { getOrCreateSubject, resolveSubjectIds } from '../taxonomy.service'
import { waitForIndex } from '../search/indexer'
import {
  aiMaterialFormatsLabel,
  isAiMaterialFileExtension,
} from '#shared/utils/ai-material-formats'

const log = createLogger('ai-material-create')

export const AI_CREATE_ADAPTER_ID = 'ai-material-create'
export const AI_CREATE_ADAPTER_VERSION = '1'

const LEGACY_OFFICE = new Set(['doc', 'ppt', 'xls'])

export interface AiCreateAnalyzeResult {
  analyzeId: string
  fileName: string
  sizeBytes: number
  hasText: boolean
  extractionMethod: ExtractionMethod
  textPreview: string | null
  pageCount: number | null
  aiEnabled: boolean
  suggestions: MaterialMetadataSuggestion
  warnings: string[]
}

interface AiCreateDetected {
  fileName: string
  sizeBytes: number
  checksum: string
  stagingPath: string
  extractedTextKey: string | null
  extractionMethod: ExtractionMethod
  pageCount: number | null
  hasText: boolean
  textPreview: string | null
  suggestions: MaterialMetadataSuggestion
  warnings: string[]
}

export interface AiCreateCommitInput {
  title: string
  description?: string | null
  content?: string | null
  materialType: MaterialType
  schoolForm?: SchoolForm | string | null
  subjectIds?: string[]
  subjectNames?: string[]
  subjectName?: string | null
  gradeLevels?: GradeLevel[]
  tagNames?: string[]
  learningObjectives?: string[]
  source?: string | null
  author?: string | null
}

/**
 * Analysiert eine einzelne Datei für den KI-Assistenten beim Material-Anlegen.
 * Extrahiert Text einmal (Textebene oder Vision) und schlägt Metadaten vor.
 */
export async function analyzeAiMaterialCreate(
  file: { buffer: Buffer; fileName: string },
  userId: string | null,
  context: {
    subjectId?: string | null
    subjectName?: string | null
    gradeLevel?: GradeLevel | null
    schoolForm?: string | null
    defaultMaterialType?: MaterialType
  } = {},
): Promise<AiCreateAnalyzeResult> {
  const fileName = sanitizeFileName(file.fileName)
  const ext = extensionOf(fileName)
  if (!isAiMaterialFileExtension(ext)) {
    throw invalidInput(
      `Für den KI-Assistenten sind ${aiMaterialFormatsLabel()} erlaubt (kein Moodle-Kursarchiv).`,
    )
  }
  await validateUpload(file.buffer, fileName)

  const settings = await getAiSettings()
  const stagingPath = await storeStagingFile(file.buffer, fileName)
  const warnings: string[] = []

  try {
    let extractionMethod: ExtractionMethod = 'none'
    let pageCount: number | null = null
    let extractedText = ''

    if (isExtractable(fileName)) {
      const ensured = await ensureExtractedText(file.buffer, fileName, settings)
      extractedText = ensured.text
      extractionMethod = ensured.method
      pageCount = ensured.pageCount ?? null
    }

    let extractedTextKey: string | null = null
    if (extractedText.trim()) {
      extractedTextKey = await storeExtractedTextSidecar(stagingPath, extractedText)
    }

    if (!extractedText.trim()) {
      warnings.push(
        settings.enabled
          ? 'Kein Text gefunden – Vorschläge basieren ggf. nur auf dem Dateinamen.'
          : 'Keine Textebene und KI/Vision deaktiviert – Titel aus Dateiname.',
      )
      if (LEGACY_OFFICE.has(ext)) {
        warnings.push(
          'Ältere Office-Dateien (.doc, .ppt, .xls) benötigen LibreOffice auf dem Server für die Textextraktion.',
        )
      }
    } else if (extractionMethod === 'vision') {
      warnings.push('Text per Vision/OCR aus Scan ermittelt.')
    }

    let subjectLabel = context.subjectName?.trim() || null
    if (!subjectLabel && context.subjectId) {
      subjectLabel = await resolveSubjectName(context.subjectId)
    }

    const suggestions = await suggestMaterialMetadata({
      fileName,
      extractedText,
      settings,
      context: {
        subjectLabel,
        gradeLevel: context.gradeLevel,
        schoolForm: context.schoolForm,
        defaultMaterialType: context.defaultMaterialType ?? 'arbeitsblatt',
      },
    })

    if (
      settings.enabled
      && settings.chatModel
      && extractedText.trim()
      && !suggestions.aiUsed
    ) {
      warnings.push(
        'KI-Vorschläge konnten nicht erzeugt werden (z. B. Modell-Timeout oder ungültige Antwort). Titel stammt aus dem Dateinamen.',
      )
    }

    const checksum = sha256(file.buffer)
    const detected: AiCreateDetected = {
      fileName,
      sizeBytes: file.buffer.length,
      checksum,
      stagingPath,
      extractedTextKey,
      extractionMethod,
      pageCount,
      hasText: Boolean(extractedText.trim()),
      textPreview: extractedText.trim() ? extractedText.slice(0, 400) : null,
      suggestions,
      warnings,
    }

    const [run] = await useDatabase()
      .insert(importRuns)
      .values({
        userId,
        sourceFileName: fileName,
        sourceSizeBytes: file.buffer.length,
        sourceChecksum: checksum,
        adapterId: AI_CREATE_ADAPTER_ID,
        adapterVersion: AI_CREATE_ADAPTER_VERSION,
        status: 'vorschau',
        detected: detected as never,
        mapping: {
          subjectId: context.subjectId ?? null,
          subjectName: context.subjectName ?? '',
          gradeLevel: context.gradeLevel ?? null,
          schoolForm: context.schoolForm ?? null,
          defaultMaterialType: context.defaultMaterialType ?? 'arbeitsblatt',
        } as never,
        stagingPath,
      })
      .returning({ id: importRuns.id })

    log.info('KI-Materialanalyse abgeschlossen', {
      analyzeId: run!.id,
      extractionMethod,
      aiUsed: suggestions.aiUsed,
    })

    return {
      analyzeId: run!.id,
      fileName,
      sizeBytes: file.buffer.length,
      hasText: detected.hasText,
      extractionMethod,
      textPreview: detected.textPreview,
      pageCount,
      aiEnabled: settings.enabled,
      suggestions,
      warnings,
    }
  } catch (error) {
    await deleteFile(stagingPath)
    throw error
  }
}

export async function commitAiMaterialCreate(
  analyzeId: string,
  userId: string | null,
  input: AiCreateCommitInput,
): Promise<{ materialId: string }> {
  const db = useDatabase()
  const [run] = await db.select().from(importRuns).where(eq(importRuns.id, analyzeId)).limit(1)
  if (!run) throw notFound('Die KI-Analyse')
  if (run.adapterId !== AI_CREATE_ADAPTER_ID) {
    throw appError('UNGUELTIGE_EINGABE', 'Dieser Vorgang ist keine KI-Materialanalyse.')
  }
  if (run.status !== 'vorschau' && run.status !== 'analysiert') {
    throw appError('KONFLIKT', 'Diese Analyse wurde bereits übernommen oder verworfen.')
  }

  const detected = (run.detected ?? {}) as unknown as AiCreateDetected
  if (!detected.stagingPath) {
    throw appError('IMPORT_FEHLER', 'Die hochgeladene Datei ist nicht mehr verfügbar.')
  }

  const title = input.title.trim()
  if (!title) throw invalidInput('Bitte einen Titel angeben.')

  let subjectIds = input.subjectIds ?? []
  if (input.subjectNames?.length) {
    subjectIds = await resolveSubjectIds([], input.subjectNames)
  } else if (!subjectIds.length && input.subjectName?.trim()) {
    subjectIds = [await getOrCreateSubject(input.subjectName.trim())]
  }

  const buffer = await readFile(resolveStoragePath(detected.stagingPath))
  const seededText = await readExtractedTextSidecar(detected.extractedTextKey)

  const materialId = await createMaterial(
    {
      title,
      description: input.description?.trim() || null,
      content: input.content?.trim() || null,
      materialType: input.materialType,
      schoolForm: (input.schoolForm as SchoolForm | null) ?? null,
      origin: 'ki',
      subjectIds,
      gradeLevels: input.gradeLevels ?? [],
      tagNames: input.tagNames ?? [],
      learningObjectives: input.learningObjectives ?? [],
      source: input.source?.trim() || null,
      author: input.author?.trim() || null,
      aiMeta: {
        generatedAt: new Date().toISOString(),
        promptVersion: MATERIAL_METADATA_PROMPT_VERSION,
        sourceFileName: detected.fileName,
        extractionMethod: detected.extractionMethod,
      },
    },
    userId,
  )

  const variantRows = await db.execute<{ id: string }>(
    sql`select id from material_variants
      where material_id = ${materialId}::uuid order by sort_order limit 1`,
  )
  const variantId = (variantRows as unknown as { id: string }[])[0]?.id
  if (!variantId) throw appError('INTERNER_FEHLER', 'Standardfassung fehlt.')

  await addFileAsset(
    variantId,
    { buffer, fileName: detected.fileName },
    {
      role: 'haupt',
      preExtracted: seededText
        ? {
            text: seededText,
            status: 'erfolgreich',
            pageCount: detected.pageCount,
            method: detected.extractionMethod,
          }
        : undefined,
      skipContentAutofill: true,
    },
  )

  await deleteFile(detected.stagingPath)
  if (detected.extractedTextKey) await deleteFile(detected.extractedTextKey)

  await db
    .update(importRuns)
    .set({
      status: 'importiert',
      finishedAt: new Date(),
      stagingPath: null,
      stats: { materialien: 1, dateien: 1 } as never,
    })
    .where(eq(importRuns.id, analyzeId))

  await waitForIndex()
  log.info('KI-Material angelegt', { analyzeId, materialId })
  return { materialId }
}

export async function discardAiMaterialCreate(analyzeId: string): Promise<void> {
  const db = useDatabase()
  const [run] = await db.select().from(importRuns).where(eq(importRuns.id, analyzeId)).limit(1)
  if (!run) throw notFound('Die KI-Analyse')
  if (run.adapterId !== AI_CREATE_ADAPTER_ID) {
    throw appError('UNGUELTIGE_EINGABE', 'Dieser Vorgang ist keine KI-Materialanalyse.')
  }
  if (!['vorschau', 'analysiert', 'fehlgeschlagen'].includes(run.status)) {
    throw appError('KONFLIKT', 'Nur offene Analysen können verworfen werden.')
  }

  const detected = (run.detected ?? {}) as unknown as AiCreateDetected
  if (detected.stagingPath) await deleteFile(detected.stagingPath)
  if (detected.extractedTextKey) await deleteFile(detected.extractedTextKey)
  await db.delete(importRuns).where(eq(importRuns.id, analyzeId))
}

async function resolveSubjectName(subjectId: string): Promise<string | null> {
  const rows = await useDatabase().execute<{ name: string }>(
    sql`select name from subjects where id = ${subjectId}::uuid limit 1`,
  )
  return (rows as unknown as { name: string }[])[0]?.name ?? null
}
