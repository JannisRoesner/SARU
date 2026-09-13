import { readFile } from 'node:fs/promises'
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { oeffentlicheFehlermeldung } from '#shared/utils/public-error'
import { isAiMaterialFileName } from '#shared/utils/ai-material-formats'
import type { MaterialType } from '#shared/types/domain'
import { useDatabase } from '../../database/client'
import {
  importLogs,
  importRunItems,
  importRuns,
  type ImportStats,
} from '../../database/schema'
import { appError, invalidInput, notFound } from '../../utils/errors'
import { sha256 } from '../../utils/crypto'
import { createLogger } from '../../utils/logger'
import { findAttachmentDuplicates } from '../import/duplicates'
import { addFileAsset, addRelation, createMaterial, deleteMaterial } from '../material.service'
import {
  ensureExtractedText,
  readExtractedTextSidecar,
  storeExtractedTextSidecar,
} from '../ai/document-text'
import { MATERIAL_METADATA_PROMPT_VERSION } from '../ai/suggest-material-metadata'
import { getAiSettings, getUploadSettings } from '../settings.service'
import {
  deleteFile,
  extensionOf,
  formatBytes,
  resolveStoragePath,
  sanitizeFileName,
  storeStagingFile,
  validateUpload,
} from '../storage.service'
import { getMaterialDetail } from '../../repositories/material.repository'
import { getOrCreateSubject, resolveSubjectIds } from '../taxonomy.service'
import { waitForIndex } from '../search/indexer'
import { mapLimit } from '../../utils/async'
import { BULK_FOLDER_ROLE_LABELS, resolveBulkGradeLevels } from '#shared/utils/bulk-upload'
import { suggestFileMetadata, titleFromFileName } from './suggest-metadata'
import { AI_CREATE_ADAPTER_ID } from '../ai/material-create'
import { clusterBulkFiles, detectFolderRole, filesAsSingletonClusters } from './pairing'
import { expandBulkArchives } from './zip'
import {
  BULK_AI_CONCURRENCY,
  BULK_EXTRACT_CONCURRENCY,
  BULK_PDF_ADAPTER_ID,
  BULK_PDF_ADAPTER_LABEL,
  BULK_PDF_ADAPTER_VERSION,
  MAX_BULK_FILES,
  type BulkFileRole,
  type BulkUploadDetected,
  type BulkUploadDetectedCluster,
  type BulkUploadDetectedFile,
  type BulkUploadInputFile,
  type BulkUploadMapping,
  type BulkUploadRecordDecision,
  type BulkUploadStats,
} from './types'

const log = createLogger('bulk-upload')

export type { BulkUploadInputFile }

function isBulkRun(adapterId: string): boolean {
  return adapterId === BULK_PDF_ADAPTER_ID
}

async function requireBulkRun(runId: string) {
  const [run] = await useDatabase().select().from(importRuns).where(eq(importRuns.id, runId)).limit(1)
  if (!run) throw notFound('Der Stapel-Upload')
  if (!isBulkRun(run.adapterId)) {
    throw appError('UNGUELTIGE_EINGABE', 'Dieser Vorgang ist kein Stapel-Upload.')
  }
  return run
}

async function addLog(
  runId: string,
  level: 'info' | 'warnung' | 'fehler',
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  await useDatabase()
    .insert(importLogs)
    .values({ runId, level, message, context: context ?? null })
}

async function resolveSubjectLabel(mapping: BulkUploadMapping): Promise<string | null> {
  if (mapping.subjectName?.trim()) return mapping.subjectName.trim()
  if (!mapping.subjectId) return null
  const rows = await useDatabase().execute<{ name: string }>(
    sql`select name from subjects where id = ${mapping.subjectId}::uuid limit 1`,
  )
  return (rows as unknown as { name: string }[])[0]?.name ?? null
}

function splitUploadPath(file: BulkUploadInputFile): { fileName: string; relativePath: string } {
  const raw = (file.relativePath || file.fileName).replace(/\\/g, '/')
  const parts = raw.split('/').filter(Boolean)
  const base = sanitizeFileName(parts.pop() || file.fileName)
  const relativePath = parts.length ? `${parts.join('/')}/${base}` : base
  return { fileName: base, relativePath }
}

function resolveClusters(detected: BulkUploadDetected): BulkUploadDetectedCluster[] {
  if (detected.clusters?.length) return detected.clusters
  return filesAsSingletonClusters(detected.files ?? [])
}

function clusterDuplicate(
  cluster: BulkUploadDetectedCluster,
  filesByRef: Map<string, BulkUploadDetectedFile>,
) {
  for (const ref of cluster.fileRefs) {
    const dup = filesByRef.get(ref)?.duplicate
    if (dup) return dup
  }
  return null
}

function buildBulkMapping(mappingInput: BulkUploadMapping): BulkUploadMapping {
  return {
    subjectId: mappingInput.subjectId ?? null,
    subjectName: mappingInput.subjectName ?? '',
    gradeLevels: resolveBulkGradeLevels(mappingInput),
    schoolForm: mappingInput.schoolForm ?? null,
    defaultMaterialType: mappingInput.defaultMaterialType ?? 'arbeitsblatt',
    linkDuplicates: mappingInput.linkDuplicates ?? true,
    createLehrwerk: mappingInput.createLehrwerk ?? false,
    lehrwerkTitle: mappingInput.lehrwerkTitle ?? '',
    lehrwerkId: mappingInput.lehrwerkId ?? null,
    records: {},
  }
}

/**
 * Legt den Stapel an und speichert die Dateien. Textextraktion und KI laufen
 * danach im Hintergrund – sonst 504 am Reverse-Proxy bei großen Ordnern.
 */
export async function startBulkPdfUpload(
  files: BulkUploadInputFile[],
  userId: string | null,
  mappingInput: BulkUploadMapping = {},
): Promise<{ runId: string; fileCount: number; status: 'laeuft'; aiEnabled: boolean }> {
  if (!files.length) throw invalidInput('Bitte mindestens eine Datei auswählen.')

  const expanded = expandBulkArchives(files)
  if (!expanded.files.length) {
    throw invalidInput('Im Paket wurden keine unterstützten Dokumente gefunden.')
  }
  if (expanded.files.length > MAX_BULK_FILES) {
    throw invalidInput(`Maximal ${MAX_BULK_FILES} Dateien pro Stapel sind erlaubt.`)
  }

  const uploadSettings = await getUploadSettings()
  const totalIncoming = expanded.files.reduce((sum, file) => sum + file.buffer.length, 0)
  if (totalIncoming > uploadSettings.maxImportBytes) {
    throw invalidInput(
      `Das Paket ist mit ${formatBytes(totalIncoming)} größer als das Limit von ${formatBytes(uploadSettings.maxImportBytes)}.`,
    )
  }

  const prepared: BulkUploadInputFile[] = []
  const rejected: string[] = []
  for (const file of expanded.files) {
    const { fileName, relativePath } = splitUploadPath(file)
    if (!isAiMaterialFileName(fileName)) {
      rejected.push(fileName)
      continue
    }
    try {
      await validateUpload(file.buffer, fileName)
      prepared.push({ buffer: file.buffer, fileName, relativePath })
    } catch {
      rejected.push(fileName)
    }
  }
  if (!prepared.length) {
    throw invalidInput('Im Paket wurden keine gültigen Dokumente gefunden.')
  }

  const mapping = buildBulkMapping(mappingInput)
  const settings = await getAiSettings()
  const checksums = prepared.map((file) => sha256(file.buffer))
  const stagingPaths: string[] = []

  try {
    const stubFiles = await mapLimit(prepared, 8, async (file, index) => {
      const checksum = checksums[index]!
      const stagingPath = await storeStagingFile(file.buffer, file.fileName)
      stagingPaths.push(stagingPath)
      return {
        sourceRef: `file:${index}:${checksum.slice(0, 12)}`,
        fileName: file.fileName,
        relativePath: file.relativePath ?? file.fileName,
        folderRole: detectFolderRole(file.relativePath, file.fileName),
        sizeBytes: file.buffer.length,
        checksum,
        stagingPath,
        extractedTextKey: null,
        extractionMethod: 'none' as const,
        pageCount: null,
        hasText: false,
        textPreview: null,
        duplicate: null,
        warnings: [],
      } satisfies BulkUploadDetectedFile
    })

    const firstName = expanded.archiveNames[0] ?? prepared[0]!.fileName
    const sourceFileName =
      expanded.archiveNames.length === 1
        ? expanded.archiveNames[0]!
        : prepared.length === 1
          ? firstName
          : `${prepared.length} Dateien (u. a. ${firstName})`

    const [run] = await useDatabase()
      .insert(importRuns)
      .values({
        userId,
        sourceFileName,
        sourceSizeBytes: totalIncoming,
        sourceChecksum: sha256(Buffer.from(checksums.join('|'))),
        adapterId: BULK_PDF_ADAPTER_ID,
        adapterVersion: BULK_PDF_ADAPTER_VERSION,
        status: 'laeuft',
        detected: {
          files: stubFiles,
          clusters: [],
          aiEnabled: settings.enabled,
          aiErrors: 0,
          analysisPending: true,
          archiveNames: expanded.archiveNames,
          skippedCount: expanded.skipped.length + rejected.length,
        } satisfies BulkUploadDetected as never,
        mapping: mapping as never,
        stagingPath: stubFiles[0]?.stagingPath ?? null,
      })
      .returning({ id: importRuns.id })

    const runId = run!.id
    await addLog(
      runId,
      'info',
      `${prepared.length} Datei${prepared.length === 1 ? '' : 'en'} angenommen (${formatBytes(totalIncoming)}). Analyse läuft im Hintergrund.`,
    )
    if (expanded.archiveNames.length) {
      await addLog(runId, 'info', `ZIP entpackt: ${expanded.archiveNames.join(', ')}.`)
    }
    if (expanded.skipped.length || rejected.length) {
      await addLog(
        runId,
        'warnung',
        `${expanded.skipped.length + rejected.length} Einträge übersprungen (kein unterstütztes oder ungültiges Dokument).`,
      )
    }

    log.info('Stapel-Upload gestartet', {
      runId,
      files: prepared.length,
      aiEnabled: settings.enabled,
    })
    return { runId, fileCount: prepared.length, status: 'laeuft', aiEnabled: settings.enabled }
  } catch (error) {
    for (const path of stagingPaths) await deleteFile(path)
    throw error
  }
}

/** Textextraktion, Cluster und KI-Vorschläge – nicht im HTTP-Request. */
export async function processBulkPdfUpload(runId: string): Promise<void> {
  const run = await requireBulkRun(runId)
  const detected = (run.detected ?? {}) as unknown as BulkUploadDetected
  if (!detected.analysisPending || run.status !== 'laeuft') return

  const mapping: BulkUploadMapping = {
    ...((run.mapping as unknown as BulkUploadMapping | null) ?? {}),
    records: { ...(((run.mapping as unknown as BulkUploadMapping | null)?.records) ?? {}) },
  }
  const files = detected.files ?? []
  if (!files.length) {
    await useDatabase()
      .update(importRuns)
      .set({
        status: 'fehlgeschlagen',
        errorMessage: 'Keine Dateien in diesem Stapel gefunden.',
        finishedAt: new Date(),
      })
      .where(eq(importRuns.id, runId))
    return
  }

  const settings = await getAiSettings()
  const subjectLabel = await resolveSubjectLabel(mapping)
  const duplicates = await findAttachmentDuplicates(files.map((file) => file.checksum))

  try {
    await addLog(runId, 'info', 'Texte werden gelesen …')
    const detectedFiles = await mapLimit(files, BULK_EXTRACT_CONCURRENCY, async (file) => {
      const buffer = await readFile(resolveStoragePath(file.stagingPath))
      const extraction = await ensureExtractedText(buffer, file.fileName, settings)
      const hasText = Boolean(extraction.text.trim())
      const warnings: string[] = []

      let extractedTextKey: string | null = null
      if (hasText) {
        extractedTextKey = await storeExtractedTextSidecar(file.stagingPath, extraction.text)
      }

      if (!hasText) {
        warnings.push(
          settings.enabled
            ? settings.useVision
              ? 'Kein Text gefunden (weder Textebene noch Vision). Titel und Beschreibung kommen aus Dateiname und Kontext.'
              : 'Keine Textebene gefunden. Vision/OCR ist in den Einstellungen aus.'
            : 'Keine Textebene gefunden (vermutlich Scan). KI/Vision ist deaktiviert.',
        )
      } else if (extraction.method === 'vision') {
        warnings.push('Text per Vision/OCR aus Scan ermittelt.')
      }
      if (!titleFromFileName(file.fileName)) {
        warnings.push('Leerer Titel nach Bereinigung des Dateinamens.')
      }

      const duplicate = duplicates.get(file.checksum)
      if (duplicate) {
        warnings.push(`Mögliche Dublette: „${duplicate.title}“.`)
      }

      return {
        ...file,
        extractedTextKey,
        extractionMethod: extraction.method,
        pageCount: extraction.pageCount ?? null,
        hasText,
        textPreview: hasText ? extraction.text.slice(0, 400) : null,
        duplicate: duplicate
          ? {
              materialId: duplicate.materialId,
              title: duplicate.title,
              reason: duplicate.reason,
            }
          : null,
        warnings,
      } satisfies BulkUploadDetectedFile
    })

    const filesByRef = new Map(detectedFiles.map((file) => [file.sourceRef, file]))
    const clusters = clusterBulkFiles(
      detectedFiles.map((file) => ({
        sourceRef: file.sourceRef,
        fileName: file.fileName,
        relativePath: file.relativePath,
        extension: extensionOf(file.fileName),
      })),
      mapping.defaultMaterialType ?? 'arbeitsblatt',
    )

    let aiErrors = 0
    for (const cluster of clusters) {
      const clusterFiles = cluster.fileRefs
        .map((ref) => filesByRef.get(ref))
        .filter((file): file is BulkUploadDetectedFile => Boolean(file))
      for (const file of clusterFiles) {
        cluster.warnings.push(...file.warnings)
      }
    }

    if (settings.enabled) {
      await addLog(runId, 'info', `KI-Vorschläge für ${clusters.length} Bündel werden erzeugt …`)
      await mapLimit(clusters, BULK_AI_CONCURRENCY, async (cluster) => {
        const primaryRef =
          cluster.fileRefs.find((ref) => cluster.suggestedRoles[ref] === 'schueler') ??
          cluster.fileRefs.find((ref) => cluster.suggestedRoles[ref] === 'einzeln') ??
          cluster.fileRefs[0]
        const primary = primaryRef ? filesByRef.get(primaryRef) : undefined
        const extractedText = primary?.extractedTextKey
          ? ((await readExtractedTextSidecar(primary.extractedTextKey)) ?? '')
          : ''
        const extraContext = [
          primary?.relativePath && primary.relativePath !== primary.fileName
            ? `Pfad im Paket: ${primary.relativePath}`
            : null,
          primary?.folderRole && primary.folderRole !== 'sonstiges'
            ? `Ordner: ${BULK_FOLDER_ROLE_LABELS[primary.folderRole]}`
            : null,
        ]
          .filter(Boolean)
          .join('\n')

        try {
          const suggestions = await suggestFileMetadata({
            fileName: primary?.relativePath || primary?.fileName || cluster.stem,
            extractedText,
            mapping: {
              ...mapping,
              defaultMaterialType: cluster.suggestions.materialType,
            },
            subjectLabel,
            extraContext: extraContext || null,
            settings,
          })
          cluster.suggestions = {
            ...suggestions,
            title: suggestions.title || cluster.suggestions.title,
            materialType: cluster.suggestions.materialType,
          }
          if (!cluster.suggestions.aiUsed) aiErrors += 1
        } catch {
          aiErrors += 1
        }
      })
    }

    mapping.records = {}
    for (const cluster of clusters) {
      const clusterFiles = cluster.fileRefs
        .map((ref) => filesByRef.get(ref))
        .filter((file): file is BulkUploadDetectedFile => Boolean(file))

      if (!cluster.suggestions.title.trim()) {
        cluster.warnings.push('Leerer Titel – bitte vor dem Anlegen ergänzen.')
      }

      for (const file of clusterFiles) {
        file.suggestions = cluster.suggestions
      }

      const duplicate = clusterDuplicate(cluster, filesByRef)
      const skipDuplicate = Boolean(duplicate) && mapping.linkDuplicates !== false
      mapping.records[cluster.clusterId] = {
        include: !skipDuplicate,
        title: cluster.suggestions.title,
        materialType: cluster.suggestions.materialType,
        description: cluster.suggestions.description,
        tagNames: cluster.suggestions.tagNames,
        learningObjectives: cluster.suggestions.learningObjectives ?? [],
        content: cluster.suggestions.contentSummary ?? '',
        action: skipDuplicate ? 'ueberspringen' : 'erstellen',
        duplicateOfId: duplicate?.materialId ?? null,
        fileRoles: { ...cluster.suggestedRoles },
        links: Object.fromEntries(
          cluster.proposedLinks.map((link) => [link.targetClusterId, link.confidence === 'hoch']),
        ),
      }
    }

    await useDatabase()
      .update(importRuns)
      .set({
        status: 'vorschau',
        detected: {
          files: detectedFiles,
          clusters,
          aiEnabled: settings.enabled,
          aiErrors,
          analysisPending: false,
          archiveNames: detected.archiveNames,
          skippedCount: detected.skippedCount,
        } satisfies BulkUploadDetected as never,
        mapping: mapping as never,
        errorMessage: null,
      })
      .where(eq(importRuns.id, runId))

    await addLog(
      runId,
      'info',
      `${detectedFiles.length} Datei${detectedFiles.length === 1 ? '' : 'en'} in ${clusters.length} Bündel analysiert.`,
    )
    if (settings.enabled) {
      await addLog(
        runId,
        aiErrors ? 'warnung' : 'info',
        aiErrors
          ? `KI-Vorschläge für ${aiErrors} von ${clusters.length} Bündeln unvollständig. Fehlende Felder nutzen Dateiname und Ordner.`
          : settings.useVision
            ? `Textextraktion (inkl. Vision/OCR bei Scans) und KI-Metadaten für ${clusters.length} Bündel erzeugt.`
            : `KI-Metadaten für ${clusters.length} Bündel erzeugt. Vision/OCR ist in den Einstellungen aus.`,
      )
    } else {
      await addLog(runId, 'info', 'KI deaktiviert – Titel aus Dateinamen abgeleitet.')
    }

    log.info('Stapel-Upload analysiert', {
      runId,
      files: detectedFiles.length,
      clusters: clusters.length,
      aiEnabled: settings.enabled,
    })
  } catch (error) {
    const message = oeffentlicheFehlermeldung(error, 'Die Stapel-Analyse ist fehlgeschlagen.')
    await useDatabase()
      .update(importRuns)
      .set({
        status: 'fehlgeschlagen',
        errorMessage: message,
        finishedAt: new Date(),
        detected: { ...detected, analysisPending: false } as never,
      })
      .where(eq(importRuns.id, runId))
    await addLog(runId, 'fehler', message)
    log.warn('Stapel-Analyse fehlgeschlagen', { runId, error })
  }
}

/**
 * Synchroner Einstieg für Tests: startet und wartet auf die Vorschau.
 */
export async function analyzeBulkPdfUpload(
  files: BulkUploadInputFile[],
  userId: string | null,
  mappingInput: BulkUploadMapping = {},
): Promise<{ runId: string; fileCount: number; aiEnabled: boolean; clusterCount: number }> {
  const started = await startBulkPdfUpload(files, userId, mappingInput)
  await processBulkPdfUpload(started.runId)
  const overview = await getBulkRunOverview(started.runId)
  if (overview.status === 'fehlgeschlagen') {
    throw appError('IMPORT_FEHLER', overview.errorMessage || 'Die Analyse ist fehlgeschlagen.')
  }
  return {
    runId: started.runId,
    fileCount: started.fileCount,
    clusterCount: overview.clusters.length,
    aiEnabled: overview.aiEnabled,
  }
}

export async function updateBulkMapping(runId: string, mapping: BulkUploadMapping): Promise<void> {
  const run = await requireBulkRun(runId)
  if (run.status !== 'vorschau' && run.status !== 'analysiert') {
    throw appError('KONFLIKT', 'Die Zuordnung kann in diesem Status nicht mehr geändert werden.')
  }

  const previous = (run.mapping as unknown as BulkUploadMapping | null) ?? {}
  const merged: BulkUploadMapping = {
    ...previous,
    ...mapping,
    gradeLevels: resolveBulkGradeLevels(
      mapping.gradeLevels !== undefined ? mapping : { ...previous, ...mapping },
    ),
  }

  const [updated] = await useDatabase()
    .update(importRuns)
    .set({ mapping: merged as never })
    .where(eq(importRuns.id, runId))
    .returning({ id: importRuns.id })
  if (!updated) throw notFound('Der Stapel-Upload')
}

export interface BulkCommitResult {
  runId: string
  status: 'importiert' | 'teilweise_importiert' | 'fehlgeschlagen'
  stats: BulkUploadStats
  errors: { sourceRef: string; message: string }[]
  materialIds: string[]
}

async function defaultVariantId(materialId: string): Promise<string> {
  const variantRows = await useDatabase().execute<{ id: string }>(
    sql`select id from material_variants
      where material_id = ${materialId}::uuid order by sort_order limit 1`,
  )
  return (variantRows as unknown as { id: string }[])[0]!.id
}

async function attachStagedAsset(
  variantId: string,
  file: BulkUploadDetectedFile,
  role: 'haupt' | 'anhang',
): Promise<void> {
  const buffer = await readFile(resolveStoragePath(file.stagingPath))
  const seededText = (await readExtractedTextSidecar(file.extractedTextKey)) ?? null
  await addFileAsset(
    variantId,
    { buffer, fileName: file.fileName },
    {
      role,
      preExtracted: seededText
        ? {
            text: seededText,
            status: 'erfolgreich',
            pageCount: file.pageCount,
            method: file.extractionMethod ?? 'text_layer',
          }
        : undefined,
      skipContentAutofill: true,
    },
  )
  await deleteFile(file.stagingPath)
  if (file.extractedTextKey) await deleteFile(file.extractedTextKey)
}

function decisionForCluster(
  cluster: BulkUploadDetectedCluster,
  mapping: BulkUploadMapping,
): BulkUploadRecordDecision | undefined {
  return mapping.records?.[cluster.clusterId] ?? mapping.records?.[cluster.fileRefs[0] ?? '']
}

export async function commitBulkUpload(
  runId: string,
  userId: string | null,
  mappingOverride?: BulkUploadMapping,
): Promise<BulkCommitResult> {
  const run = await requireBulkRun(runId)
  if (run.status === 'importiert' || run.status === 'teilweise_importiert') {
    throw appError('KONFLIKT', 'Dieser Stapel wurde bereits übernommen.')
  }

  const mapping: BulkUploadMapping = {
    ...((run.mapping as unknown as BulkUploadMapping | null) ?? {}),
    ...(mappingOverride ?? {}),
  }
  if (mappingOverride) await updateBulkMapping(runId, mapping)

  const detected = (run.detected ?? {}) as unknown as BulkUploadDetected
  const files = detected.files ?? []
  if (!files.length) throw appError('IMPORT_FEHLER', 'Keine Dateien in diesem Stapel gefunden.')
  const filesByRef = new Map(files.map((file) => [file.sourceRef, file]))
  const clusters = resolveClusters(detected)

  const db = useDatabase()
  await db.update(importRuns).set({ status: 'laeuft' }).where(eq(importRuns.id, runId))

  let subjectId: string | null = mapping.subjectId ?? null
  if (!subjectId && mapping.subjectName?.trim()) {
    subjectId = await getOrCreateSubject(mapping.subjectName.trim())
  }

  const gradeLevels = resolveBulkGradeLevels(mapping)
  const stats: BulkUploadStats = {
    materialien: 0,
    dateien: 0,
    verknuepft: 0,
    uebersprungen: 0,
    fehlgeschlagen: 0,
  }
  const errors: { sourceRef: string; message: string }[] = []
  const materialIds: string[] = []
  const primaryByCluster = new Map<string, string>()
  let sequence = 0

  const track = async (
    sourceRef: string,
    entityId: string | null,
    action: 'erstellt' | 'verknuepft' | 'uebersprungen' | 'fehlgeschlagen',
    message?: string,
    duplicateOfId?: string | null,
  ) => {
    await db.insert(importRunItems).values({
      runId,
      sourceRef,
      entityType: 'material',
      entityId,
      action,
      duplicateOfId: duplicateOfId ?? null,
      message: message ?? null,
      sequence: sequence++,
    })
  }

  const createOne = async (input: {
    title: string
    materialType: MaterialType
    description: string | null
    content: string | null
    tagNames: string[]
    learningObjectives: string[]
    schoolForm: string | null
    subjectIds: string[]
    sourceFileName: string
    extractionMethod?: BulkUploadDetectedFile['extractionMethod']
    aiUsed: boolean
    assets: { file: BulkUploadDetectedFile; role: 'haupt' | 'anhang' }[]
  }): Promise<string> => {
    const materialId = await createMaterial(
      {
        title: input.title,
        description: input.description,
        content: input.content,
        materialType: input.materialType,
        origin: 'manuell',
        schoolForm: input.schoolForm,
        subjectIds: input.subjectIds,
        gradeLevels,
        tagNames: input.tagNames,
        learningObjectives: input.learningObjectives,
        aiMeta: input.aiUsed
          ? {
              generatedAt: new Date().toISOString(),
              promptVersion: MATERIAL_METADATA_PROMPT_VERSION,
              sourceFileName: input.sourceFileName,
              extractionMethod: input.extractionMethod,
            }
          : null,
      },
      userId,
    )
    const variantId = await defaultVariantId(materialId)
    for (const asset of input.assets) {
      await attachStagedAsset(variantId, asset.file, asset.role)
      stats.dateien = (stats.dateien ?? 0) + 1
    }
    materialIds.push(materialId)
    stats.materialien = (stats.materialien ?? 0) + 1
    return materialId
  }

  let lehrwerkId: string | null = null
  if (mapping.createLehrwerk && mapping.lehrwerkId) {
    try {
      const existing = await getMaterialDetail(mapping.lehrwerkId)
      if (!existing || existing.materialType !== 'lehrwerk') {
        throw invalidInput('Das gewählte Lehrwerk wurde nicht gefunden.')
      }
      lehrwerkId = existing.id
      mapping.lehrwerkId = lehrwerkId
      await track('lehrwerk', lehrwerkId, 'verknuepft', 'Bestehendes Lehrwerk')
    } catch (error) {
      const message = oeffentlicheFehlermeldung(error, 'Das Lehrwerk konnte nicht zugeordnet werden.')
      stats.fehlgeschlagen = (stats.fehlgeschlagen ?? 0) + 1
      errors.push({ sourceRef: 'lehrwerk', message })
      await track('lehrwerk', null, 'fehlgeschlagen', message)
    }
  } else if (mapping.createLehrwerk && mapping.lehrwerkTitle?.trim()) {
    try {
      lehrwerkId = await createMaterial(
        {
          title: mapping.lehrwerkTitle.trim(),
          materialType: 'lehrwerk',
          origin: 'manuell',
          schoolForm: mapping.schoolForm ?? null,
          subjectIds: subjectId ? [subjectId] : [],
          gradeLevels,
        },
        userId,
      )
      materialIds.push(lehrwerkId)
      mapping.lehrwerkId = lehrwerkId
      stats.materialien = (stats.materialien ?? 0) + 1
      await track('lehrwerk', lehrwerkId, 'erstellt', 'Lehrwerk-Paket')
    } catch (error) {
      const message = oeffentlicheFehlermeldung(error, 'Das Lehrwerk konnte nicht angelegt werden.')
      stats.fehlgeschlagen = (stats.fehlgeschlagen ?? 0) + 1
      errors.push({ sourceRef: 'lehrwerk', message })
      await track('lehrwerk', null, 'fehlgeschlagen', message)
    }
  }

  for (const cluster of clusters) {
    const decision = decisionForCluster(cluster, mapping)
    if (decision?.include === false) {
      stats.uebersprungen = (stats.uebersprungen ?? 0) + 1
      await track(
        cluster.clusterId,
        decision.duplicateOfId ?? clusterDuplicate(cluster, filesByRef)?.materialId ?? null,
        'uebersprungen',
        clusterDuplicate(cluster, filesByRef) ? 'Als Dublette übersprungen' : 'Vom Nutzer abgewählt',
        decision.duplicateOfId ?? clusterDuplicate(cluster, filesByRef)?.materialId,
      )
      continue
    }

    const title = (decision?.title ?? cluster.suggestions.title).trim()
    if (!title) {
      stats.fehlgeschlagen = (stats.fehlgeschlagen ?? 0) + 1
      errors.push({ sourceRef: cluster.clusterId, message: 'Titel fehlt.' })
      await track(cluster.clusterId, null, 'fehlgeschlagen', 'Titel fehlt')
      await addLog(runId, 'fehler', `„${cluster.stem}“: Titel fehlt.`)
      continue
    }

    const roles: Record<string, BulkFileRole> = {
      ...cluster.suggestedRoles,
      ...(decision?.fileRoles ?? {}),
    }
    const clusterFiles = cluster.fileRefs
      .map((ref) => filesByRef.get(ref))
      .filter((file): file is BulkUploadDetectedFile => Boolean(file))

    const schueler = clusterFiles.filter((file) => {
      const role = roles[file.sourceRef]
      return role === 'schueler' || role === 'einzeln' || role === 'abbildung'
    })
    const loesungen = clusterFiles.filter((file) => roles[file.sourceRef] === 'loesung')
    const anhaenge = clusterFiles.filter((file) => roles[file.sourceRef] === 'anhaengsel')
    let primaryFiles = schueler
    let solutionFiles = loesungen
    if (!primaryFiles.length && solutionFiles.length) {
      primaryFiles = solutionFiles
      solutionFiles = []
    }
    if (!primaryFiles.length) {
      primaryFiles = clusterFiles.filter((file) => roles[file.sourceRef] !== 'anhaengsel')
    }

    try {
      const materialType = (decision?.materialType ??
        cluster.suggestions.materialType ??
        mapping.defaultMaterialType ??
        'arbeitsblatt') as MaterialType
      const description =
        (decision?.description ?? cluster.suggestions.description)?.trim() || null
      const tagNames = decision?.tagNames ?? cluster.suggestions.tagNames ?? []
      const learningObjectives =
        decision?.learningObjectives ?? cluster.suggestions.learningObjectives ?? []
      const content =
        (decision?.content ?? cluster.suggestions.contentSummary)?.trim() || null
      const schoolForm =
        (cluster.suggestions.schoolForm as string | null | undefined) ?? mapping.schoolForm ?? null

      let fileSubjectIds: string[] = []
      if (subjectId) {
        fileSubjectIds = [subjectId]
      } else if (cluster.suggestions.subjectNames?.length) {
        fileSubjectIds = await resolveSubjectIds([], cluster.suggestions.subjectNames)
      }

      if (!primaryFiles.length && !solutionFiles.length) {
        throw invalidInput('Keine Datei mit übernehmbarer Rolle in diesem Bündel.')
      }

      let primaryId: string | null = null
      if (primaryFiles.length) {
        const haupt = primaryFiles[0]!
        const rest = [...primaryFiles.slice(1), ...anhaenge]
        primaryId = await createOne({
          title,
          materialType:
            !schueler.length && loesungen.length
              ? 'musterloesung'
              : solutionFiles.length && materialType === 'musterloesung'
                ? 'arbeitsblatt'
                : materialType,
          description,
          content,
          tagNames,
          learningObjectives,
          schoolForm,
          subjectIds: fileSubjectIds,
          sourceFileName: haupt.fileName,
          extractionMethod: haupt.extractionMethod,
          aiUsed: cluster.suggestions.aiUsed,
          assets: [
            { file: haupt, role: 'haupt' },
            ...rest.map((file) => ({ file, role: 'anhang' as const })),
          ],
        })
        primaryByCluster.set(cluster.clusterId, primaryId)
        await track(cluster.clusterId, primaryId, 'erstellt')
      }

      if (solutionFiles.length) {
        const solutionTitle = (decision?.solutionTitle ?? '').trim() || `Musterlösung: ${title}`
        const haupt = solutionFiles[0]!
        const solutionId = await createOne({
          title: solutionTitle,
          materialType: 'musterloesung',
          description,
          content,
          tagNames,
          learningObjectives,
          schoolForm,
          subjectIds: fileSubjectIds,
          sourceFileName: haupt.fileName,
          extractionMethod: haupt.extractionMethod,
          aiUsed: false,
          assets: [
            { file: haupt, role: 'haupt' },
            ...solutionFiles.slice(1).map((file) => ({ file, role: 'anhang' as const })),
          ],
        })
        await track(`${cluster.clusterId}:loesung`, solutionId, 'erstellt')
        if (primaryId) {
          await addRelation(primaryId, solutionId, 'musterloesung', 'Aus Stapel-Paar übernommen')
          stats.verknuepft = (stats.verknuepft ?? 0) + 1
          await track(`${cluster.clusterId}:relation`, solutionId, 'verknuepft', 'Musterlösung')
        } else {
          primaryByCluster.set(cluster.clusterId, solutionId)
        }
      }

      if (lehrwerkId && primaryByCluster.get(cluster.clusterId)) {
        await addRelation(
          primaryByCluster.get(cluster.clusterId)!,
          lehrwerkId,
          'gehoert_zu',
          'Lehrwerk-Paket',
        )
        stats.verknuepft = (stats.verknuepft ?? 0) + 1
      }
    } catch (error) {
      const message = oeffentlicheFehlermeldung(error, 'Die Datei konnte nicht übernommen werden.')
      stats.fehlgeschlagen = (stats.fehlgeschlagen ?? 0) + 1
      errors.push({ sourceRef: cluster.clusterId, message })
      await track(cluster.clusterId, null, 'fehlgeschlagen', message)
      await addLog(runId, 'fehler', `„${cluster.stem}“: ${message}`)
    }
  }

  for (const cluster of clusters) {
    const decision = decisionForCluster(cluster, mapping)
    if (decision?.include === false) continue
    const fromId = primaryByCluster.get(cluster.clusterId)
    if (!fromId) continue
    for (const link of cluster.proposedLinks) {
      const accepted = decision?.links?.[link.targetClusterId]
      if (accepted === false) continue
      if (accepted !== true && link.confidence !== 'hoch') continue
      const toId = primaryByCluster.get(link.targetClusterId)
      if (!toId || toId === fromId) continue
      try {
        await addRelation(fromId, toId, link.relationType, link.reason)
        stats.verknuepft = (stats.verknuepft ?? 0) + 1
        await track(`${cluster.clusterId}->${link.targetClusterId}`, toId, 'verknuepft', link.reason)
      } catch (error) {
        await addLog(
          runId,
          'warnung',
          `Verknüpfung nicht übernommen: ${oeffentlicheFehlermeldung(error, link.reason)}`,
        )
      }
    }
  }

  const status: BulkCommitResult['status'] =
    (stats.fehlgeschlagen ?? 0) === 0
      ? 'importiert'
      : (stats.materialien ?? 0) > 0
        ? 'teilweise_importiert'
        : 'fehlgeschlagen'

  await db
    .update(importRuns)
    .set({
      status,
      stats: stats as ImportStats,
      finishedAt: new Date(),
      stagingPath: null,
      mapping: mapping as never,
    })
    .where(eq(importRuns.id, runId))

  await addLog(
    runId,
    status === 'importiert' ? 'info' : 'warnung',
    `Stapel abgeschlossen: ${stats.materialien} Materialien, ${stats.verknuepft ?? 0} Verknüpfungen, ${stats.uebersprungen} übersprungen, ${stats.fehlgeschlagen} fehlgeschlagen.`,
  )

  await waitForIndex()
  log.info('Stapel-Upload committed', { runId, status, stats })
  return { runId, status, stats, errors, materialIds }
}

export async function undoBulkUpload(runId: string): Promise<{ removed: BulkUploadStats }> {
  const run = await requireBulkRun(runId)
  if (run.undoneAt) throw appError('KONFLIKT', 'Dieser Stapel wurde bereits rückgängig gemacht.')
  if (!['importiert', 'teilweise_importiert'].includes(run.status)) {
    throw appError('KONFLIKT', 'Nur abgeschlossene Stapel können rückgängig gemacht werden.')
  }

  const db = useDatabase()
  const items = await db
    .select()
    .from(importRunItems)
    .where(eq(importRunItems.runId, runId))
    .orderBy(desc(importRunItems.sequence))

  const removed: BulkUploadStats = { materialien: 0 }
  const seen = new Set<string>()

  for (const item of items) {
    if (item.action !== 'erstellt' || !item.entityId || item.entityType !== 'material') continue
    if (seen.has(item.entityId)) continue
    seen.add(item.entityId)
    try {
      await deleteMaterial(item.entityId)
      removed.materialien = (removed.materialien ?? 0) + 1
    } catch (error) {
      await addLog(
        runId,
        'warnung',
        `Material konnte nicht entfernt werden: ${oeffentlicheFehlermeldung(
          error,
          'Der Eintrag konnte nicht entfernt werden.',
        )}`,
      )
    }
  }

  await db
    .update(importRuns)
    .set({ status: 'rueckgaengig', undoneAt: new Date() })
    .where(eq(importRuns.id, runId))
  await addLog(
    runId,
    'info',
    `Stapel rückgängig gemacht: ${removed.materialien} Materialien entfernt.`,
  )

  return { removed }
}

export interface BulkRunOverview {
  runId: string
  adapterLabel: string
  status: string
  sourceFileName: string
  sourceSizeBytes: number | null
  files: BulkUploadDetectedFile[]
  clusters: BulkUploadDetectedCluster[]
  mapping: BulkUploadMapping | null
  stats: BulkUploadStats | null
  errorMessage: string | null
  aiEnabled: boolean
  analysisPending: boolean
  startedAt: string
  finishedAt: string | null
  undoneAt: string | null
  canCommit: boolean
  canUndo: boolean
}

export async function getBulkRunOverview(runId: string): Promise<BulkRunOverview> {
  const run = await requireBulkRun(runId)
  const detected = (run.detected ?? {}) as unknown as BulkUploadDetected
  const analysisPending = Boolean(detected.analysisPending)
  const files = detected.files ?? []
  const clusters = analysisPending ? [] : resolveClusters(detected)

  return {
    runId: run.id,
    adapterLabel: BULK_PDF_ADAPTER_LABEL,
    status: run.status,
    sourceFileName: run.sourceFileName,
    sourceSizeBytes: run.sourceSizeBytes,
    files,
    clusters,
    mapping: (run.mapping as unknown as BulkUploadMapping | null) ?? null,
    stats: (run.stats as unknown as BulkUploadStats | null) ?? null,
    errorMessage: run.errorMessage,
    aiEnabled: Boolean(detected.aiEnabled),
    analysisPending,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    undoneAt: run.undoneAt?.toISOString() ?? null,
    canCommit: run.status === 'vorschau' || run.status === 'analysiert',
    canUndo: !run.undoneAt && ['importiert', 'teilweise_importiert'].includes(run.status),
  }
}

export async function listBulkUploads(limit = 30) {
  return useDatabase()
    .select({
      id: importRuns.id,
      sourceFileName: importRuns.sourceFileName,
      sourceSizeBytes: importRuns.sourceSizeBytes,
      status: importRuns.status,
      stats: importRuns.stats,
      errorMessage: importRuns.errorMessage,
      startedAt: importRuns.startedAt,
      finishedAt: importRuns.finishedAt,
      undoneAt: importRuns.undoneAt,
    })
    .from(importRuns)
    .where(eq(importRuns.adapterId, BULK_PDF_ADAPTER_ID))
    .orderBy(desc(importRuns.startedAt))
    .limit(limit)
}

export async function discardBulkUpload(runId: string): Promise<void> {
  const run = await requireBulkRun(runId)
  if (!['vorschau', 'analysiert', 'fehlgeschlagen'].includes(run.status)) {
    throw appError('KONFLIKT', 'Nur offene Stapel können verworfen werden.')
  }

  const detected = (run.detected ?? {}) as unknown as BulkUploadDetected
  for (const file of detected.files ?? []) {
    if (file.stagingPath) await deleteFile(file.stagingPath)
    if (file.extractedTextKey) await deleteFile(file.extractedTextKey)
  }

  await useDatabase().delete(importRuns).where(eq(importRuns.id, runId))
}

/** Für die Schulportal-Importliste: Stapel-Uploads und KI-Einzelanlagen ausblenden. */
export function excludeBulkAdapterSql() {
  return and(
    ne(importRuns.adapterId, BULK_PDF_ADAPTER_ID),
    ne(importRuns.adapterId, AI_CREATE_ADAPTER_ID),
  )
}

export { BULK_PDF_ADAPTER_ID, BULK_PDF_ADAPTER_LABEL }
