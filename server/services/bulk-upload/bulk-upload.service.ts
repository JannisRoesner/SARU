import { readFile } from 'node:fs/promises'
import { and, asc, desc, eq, inArray, max, ne, sql } from 'drizzle-orm'
import { oeffentlicheFehlermeldung } from '#shared/utils/public-error'
import { isBulkDocumentFileName } from '#shared/utils/ai-material-formats'
import { istInteraktivDatei } from '#shared/utils/interaktiv'
import type { MaterialType } from '#shared/types/domain'
import { useDatabase } from '../../database/client'
import {
  importLogs,
  importRunItems,
  importRuns,
  materialAssets,
  materialVariants,
  type ImportStats,
} from '../../database/schema'
import { appError, invalidInput, notFound } from '../../utils/errors'
import { sha256 } from '../../utils/crypto'
import { createLogger } from '../../utils/logger'
import { findAttachmentDuplicates } from '../import/duplicates'
import {
  addFileAsset,
  addRelation,
  addVariant,
  createMaterial,
  deleteMaterial,
  updateVariant,
} from '../material.service'
import {
  ensureExtractedText,
  extractedTextSidecarKey,
  readExtractedTextSidecar,
  storeExtractedTextSidecar,
} from '../ai/document-text'
import { MATERIAL_METADATA_PROMPT_VERSION } from '../ai/suggest-material-metadata'
import { getAiSettings, getUploadSettings, type AiSettings } from '../settings.service'
import {
  deleteFile,
  extensionOf,
  fileExists,
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
import {
  BULK_FOLDER_ROLE_LABELS,
  resolveBulkGradeLevels,
  type BulkLernzirkelRef,
} from '#shared/utils/bulk-upload'
import { suggestFileMetadata, titleFromFileName } from './suggest-metadata'
import { AI_CREATE_ADAPTER_ID } from '../ai/material-create'
import {
  clusterBulkFiles,
  detectFolderRole,
  fassungLabel,
  filesAsSingletonClusters,
  findLehrwerkCover,
} from './pairing'
import { expandBulkArchives } from './zip'
import {
  abortAnalysis,
  decideOrphanRecovery,
  isRunActive,
  kiNachholenFortschritt,
  registerAnalysis,
  registerCommit,
  registerKiNachholen,
  unregisterAnalysis,
  unregisterCommit,
  unregisterKiNachholen,
  type KiNachholFortschritt,
} from './run-control'
import {
  BULK_AI_CONCURRENCY,
  BULK_EXTRACT_CONCURRENCY,
  BULK_PDF_ADAPTER_ID,
  BULK_PDF_ADAPTER_LABEL,
  BULK_PDF_ADAPTER_VERSION,
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

  const uploadSettings = await getUploadSettings()
  const expanded = expandBulkArchives(files, { maxTotalBytes: uploadSettings.maxImportBytes })
  if (!expanded.files.length) {
    throw invalidInput('Im Paket wurden keine unterstützten Dokumente gefunden.')
  }
  const totalIncoming = expanded.totalBytes

  const prepared: BulkUploadInputFile[] = []
  const rejected: string[] = []
  for (const file of expanded.files) {
    const { fileName, relativePath } = splitUploadPath(file)
    if (!isBulkDocumentFileName(fileName)) {
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

/** Staging-Dateien und Textauszüge eines Stapels entfernen. */
async function deleteStagedFiles(files: BulkUploadDetectedFile[]): Promise<void> {
  for (const file of files) {
    const keys = new Set<string>()
    if (file.stagingPath) {
      keys.add(file.stagingPath)
      // Der Auszug liegt neben der Staging-Datei, auch wenn der Lauf ihn noch nicht vermerkt hat.
      keys.add(extractedTextSidecarKey(file.stagingPath))
    }
    if (file.extractedTextKey) keys.add(file.extractedTextKey)
    for (const key of keys) await deleteFile(key)
  }
}

/** Textextraktion, Cluster und KI-Vorschläge – nicht im HTTP-Request. */
export async function processBulkPdfUpload(runId: string): Promise<void> {
  const run = await requireBulkRun(runId)
  const detected = (run.detected ?? {}) as unknown as BulkUploadDetected
  if (!detected.analysisPending || run.status !== 'laeuft') return

  const signal = registerAnalysis(runId)
  try {
    await analyseBulkRun(runId, run, detected, signal)
  } finally {
    unregisterAnalysis(runId, signal)
  }
}

/**
 * Holt KI-Metadaten für ein Bündel und übernimmt sie in `cluster.suggestions`.
 * Gibt zurück, ob die KI tatsächlich geantwortet hat; sonst bleibt der Vorschlag
 * aus Dateiname und Ordner.
 */
async function clusterKiVorschlag(
  cluster: BulkUploadDetectedCluster,
  filesByRef: Map<string, BulkUploadDetectedFile>,
  mapping: BulkUploadMapping,
  subjectLabel: string | null,
  settings: AiSettings,
): Promise<boolean> {
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
    return cluster.suggestions.aiUsed
  } catch {
    return false
  }
}

async function analyseBulkRun(
  runId: string,
  run: typeof importRuns.$inferSelect,
  detected: BulkUploadDetected,
  signal: AbortSignal,
): Promise<void> {

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

  // Abbruch per Knopf (Signal in diesem Prozess) oder Stapel nicht mehr `laeuft`
  // (abgebrochen oder verworfen, auch von einem anderen Prozess aus).
  let cancelled = false
  const isCancelled = async (): Promise<boolean> => {
    if (cancelled) return true
    if (signal.aborted) return (cancelled = true)
    const [current] = await useDatabase()
      .select({ status: importRuns.status })
      .from(importRuns)
      .where(eq(importRuns.id, runId))
      .limit(1)
    if (current?.status !== 'laeuft') cancelled = true
    return cancelled
  }
  const stopAfterCancel = async (): Promise<void> => {
    const [current] = await useDatabase()
      .select({ id: importRuns.id })
      .from(importRuns)
      .where(eq(importRuns.id, runId))
      .limit(1)
    // Schon verworfen: Was nach dem Löschen noch geschrieben wurde, hier wegräumen.
    // Sonst räumt das spätere Verwerfen auf.
    if (!current) await deleteStagedFiles(files)
    log.info('Stapel-Analyse abgebrochen', { runId, verworfen: !current })
  }

  const settings = await getAiSettings()
  const subjectLabel = await resolveSubjectLabel(mapping)
  const duplicates = await findAttachmentDuplicates(files.map((file) => file.checksum))

  try {
    await addLog(runId, 'info', 'Texte werden gelesen …')
    // Bei Abbruch liefern die Bahnen `null` statt zu werfen, damit mapLimit erst endet,
    // wenn keine Extraktion mehr nebenher läuft und Dateien schreibt.
    type Extracted = BulkUploadDetectedFile | null
    const extracted = await mapLimit(files, BULK_EXTRACT_CONCURRENCY, async (file): Promise<Extracted> => {
      if (await isCancelled()) return null
      const buffer = await readFile(resolveStoragePath(file.stagingPath))
      // Interaktive Inhalte (SWF) haben keinen auslesbaren Text.
      const interaktiv = istInteraktivDatei(file.fileName)
      const extraction = interaktiv
        ? { text: '', method: 'none' as const, pageCount: null }
        : await ensureExtractedText(buffer, file.fileName, settings)
      const hasText = Boolean(extraction.text.trim())
      const warnings: string[] = []

      let extractedTextKey: string | null = null
      if (hasText) {
        extractedTextKey = await storeExtractedTextSidecar(file.stagingPath, extraction.text)
      }

      if (!hasText && !interaktiv) {
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
    if (await isCancelled()) return await stopAfterCancel()
    const detectedFiles = extracted.filter((file): file is BulkUploadDetectedFile => file !== null)

    const filesByRef = new Map<string, BulkUploadDetectedFile>(
      detectedFiles.map((file) => [file.sourceRef, file]),
    )
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
        if (await isCancelled()) return
        if (!(await clusterKiVorschlag(cluster, filesByRef, mapping, subjectLabel, settings))) aiErrors += 1
      })
      if (await isCancelled()) return await stopAfterCancel()
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

    const [saved] = await useDatabase()
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
      // Nur solange niemand abgebrochen oder verworfen hat.
      .where(and(eq(importRuns.id, runId), eq(importRuns.status, 'laeuft')))
      .returning({ id: importRuns.id })
    if (!saved) {
      cancelled = true
      return await stopAfterCancel()
    }

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
    // Verworfene Staging-Dateien lassen laufende Extraktionen scheitern – das ist kein Fehler.
    if (await isCancelled()) return await stopAfterCancel()
    const message = oeffentlicheFehlermeldung(error, 'Die Stapel-Analyse ist fehlgeschlagen.')
    const [failed] = await useDatabase()
      .update(importRuns)
      .set({
        status: 'fehlgeschlagen',
        errorMessage: message,
        finishedAt: new Date(),
        detected: { ...detected, analysisPending: false } as never,
      })
      .where(and(eq(importRuns.id, runId), eq(importRuns.status, 'laeuft')))
      .returning({ id: importRuns.id })
    if (!failed) return await stopAfterCancel()
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
  // Teilweise übernommen: Korrekturen für das erneute Anlegen der übrigen Bündel.
  if (!['vorschau', 'analysiert', 'teilweise_importiert'].includes(run.status)) {
    throw appError('KONFLIKT', 'Die Zuordnung kann in diesem Status nicht mehr geändert werden.')
  }

  if (kiNachholenFortschritt(runId)) {
    throw appError('KONFLIKT', 'Gerade werden KI-Vorschläge nachgeholt. Bitte kurz warten.')
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

type RunItem = typeof importRunItems.$inferSelect

/** Markiert Einträge, deren Materialien ein Rückgängigmachen schon entfernt hat. */
const UNDONE_PAYLOAD_KEY = 'rueckgaengig'

/** Einträge des aktuellen Durchgangs (ohne die eines früheren Rückgängigmachens), aufsteigend. */
async function activeRunItems(runId: string): Promise<RunItem[]> {
  const rows = await useDatabase()
    .select()
    .from(importRunItems)
    .where(eq(importRunItems.runId, runId))
    .orderBy(asc(importRunItems.sequence))
  return rows.filter((row) => !row.payload?.[UNDONE_PAYLOAD_KEY])
}

interface BulkRunProgress {
  /** Primäres (oder einziges) angelegtes Material je Bündel. */
  primaryByCluster: Map<string, string>
  /** Bündel, aus denen schon ein Material angelegt wurde – sie werden nicht erneut angelegt. */
  createdClusters: Set<string>
  /** Letzter Eintrag je sourceRef. */
  latest: Map<string, RunItem>
  lernzirkelIds: Map<string, string>
  createdMaterialIds: Set<string>
}

function summarizeRunItems(items: RunItem[]): BulkRunProgress {
  const progress: BulkRunProgress = {
    primaryByCluster: new Map(),
    createdClusters: new Set(),
    latest: new Map(),
    lernzirkelIds: new Map(),
    createdMaterialIds: new Set(),
  }
  for (const item of items) {
    progress.latest.set(item.sourceRef, item)
    if (item.action !== 'erstellt' || item.entityType !== 'material' || !item.entityId) continue
    progress.createdMaterialIds.add(item.entityId)
    if (item.sourceRef === 'lehrwerk') continue
    if (item.sourceRef.startsWith('lernzirkel:')) {
      progress.lernzirkelIds.set(item.sourceRef.slice('lernzirkel:'.length), item.entityId)
    } else if (item.sourceRef.endsWith(':loesung')) {
      // Nur Lösung ohne Schülerfassung: dann ist sie das primäre Material des Bündels.
      const clusterId = item.sourceRef.slice(0, -':loesung'.length)
      progress.createdClusters.add(clusterId)
      if (!progress.primaryByCluster.has(clusterId)) progress.primaryByCluster.set(clusterId, item.entityId)
    } else {
      progress.createdClusters.add(item.sourceRef)
      progress.primaryByCluster.set(item.sourceRef, item.entityId)
    }
  }
  return progress
}

export type BulkClusterOutcome = 'erstellt' | 'fehlgeschlagen' | 'uebersprungen'

function clusterOutcome(clusterId: string, progress: BulkRunProgress): BulkClusterOutcome | null {
  const latest = progress.latest.get(clusterId)
  // Auch ein Bündel, dessen Lösung nach dem Schülerblatt scheiterte, gilt als fehlgeschlagen.
  if (latest?.action === 'fehlgeschlagen') return 'fehlgeschlagen'
  if (progress.createdClusters.has(clusterId)) return 'erstellt'
  return latest?.action === 'uebersprungen' ? 'uebersprungen' : null
}

/** Noch nicht angelegte Bündel, deren Dateien im Zwischenspeicher liegen. */
function retryableClusterIds(
  clusters: BulkUploadDetectedCluster[],
  filesByRef: Map<string, BulkUploadDetectedFile>,
  progress: BulkRunProgress,
): string[] {
  return clusters
    .filter(
      (cluster) =>
        !progress.createdClusters.has(cluster.clusterId)
        && cluster.fileRefs.every((ref) => {
          const file = filesByRef.get(ref)
          return Boolean(file?.stagingPath) && !file?.stagingMissing
        }),
    )
    .map((cluster) => cluster.clusterId)
}

export async function commitBulkUpload(
  runId: string,
  userId: string | null,
  mappingOverride?: BulkUploadMapping,
): Promise<BulkCommitResult> {
  if (kiNachholenFortschritt(runId)) {
    throw appError('KONFLIKT', 'Gerade werden KI-Vorschläge nachgeholt. Bitte kurz warten.')
  }
  const state = { started: false }
  registerCommit(runId)
  try {
    return await runBulkCommit(runId, userId, mappingOverride, state)
  } catch (error) {
    // Sonst bliebe der Stapel für immer `laeuft`; angelegte Materialien bleiben rückgängig machbar.
    if (state.started) {
      await recoverInterruptedRun(runId, 'fehler').catch((recoverError) =>
        log.warn('Abgebrochene Übernahme konnte nicht abgeschlossen werden', {
          runId,
          error: recoverError,
        }),
      )
    }
    throw error
  } finally {
    unregisterCommit(runId)
  }
}

async function runBulkCommit(
  runId: string,
  userId: string | null,
  mappingOverride: BulkUploadMapping | undefined,
  state: { started: boolean },
): Promise<BulkCommitResult> {
  const run = await requireBulkRun(runId)
  if (run.status === 'importiert') {
    throw appError('KONFLIKT', 'Dieser Stapel wurde bereits übernommen.')
  }
  if (run.status === 'rueckgaengig') {
    throw appError(
      'KONFLIKT',
      'Beim Rückgängigmachen dieses Stapels wurden seine Dateien entfernt. Bitte neu hochladen.',
    )
  }
  if (run.status === 'laeuft') {
    throw appError('KONFLIKT', 'Dieser Stapel wird gerade verarbeitet.')
  }
  // Teilweise übernommen: nur die noch nicht angelegten Bündel nachholen.
  const isRetry = run.status === 'teilweise_importiert'

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
  const prior = summarizeRunItems(await activeRunItems(runId))
  const [{ value: highestSequence } = { value: null }] = await db
    .select({ value: max(importRunItems.sequence) })
    .from(importRunItems)
    .where(eq(importRunItems.runId, runId))

  await db.update(importRuns).set({ status: 'laeuft' }).where(eq(importRuns.id, runId))
  state.started = true

  let subjectId: string | null = mapping.subjectId ?? null
  if (!subjectId && mapping.subjectName?.trim()) {
    subjectId = await getOrCreateSubject(mapping.subjectName.trim())
  }

  const gradeLevels = resolveBulkGradeLevels(mapping)
  // Zähler dieses Durchgangs; beim Nachholen werden sie zu den bisherigen addiert.
  const stats: BulkUploadStats = {
    materialien: 0,
    dateien: 0,
    verknuepft: 0,
  }
  const errors: { sourceRef: string; message: string }[] = []
  const materialIds: string[] = []
  const primaryByCluster = new Map<string, string>(prior.primaryByCluster)
  /** In diesem Durchgang angelegte Bündel. */
  const createdNow = new Set<string>()
  let sequence = (highestSequence ?? -1) + 1

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
    /** Weitere Fassungen desselben Materials – jede wird eine eigene Variante. */
    fassungen?: BulkUploadDetectedFile[]
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
    let dateien = 0
    let fassungen = 0
    try {
      const variantId = await defaultVariantId(materialId)
      for (const asset of input.assets) {
        await attachStagedAsset(variantId, asset.file, asset.role)
        dateien += 1
      }
      if (input.fassungen?.length) {
        // Bezeichnung der ersten Fassung aus dem Dateinamen („… - Fassung Handbuch“).
        const hauptLabel = fassungLabel(input.assets.find((a) => a.role === 'haupt')?.file.fileName ?? '')
        if (hauptLabel) await updateVariant(variantId, { label: hauptLabel })
        for (const file of input.fassungen) {
          const extraId = await addVariant(materialId, {
            label: fassungLabel(file.fileName) ?? 'Weitere Fassung',
            variantKind: 'standard',
          })
          await attachStagedAsset(extraId, file, 'haupt')
          dateien += 1
          fassungen += 1
        }
      }
    } catch (error) {
      // Sonst bliebe ein halbes Material zurück, das kein Eintrag kennt und kein Undo entfernt.
      await deleteMaterial(materialId).catch(() => undefined)
      throw error
    }
    stats.dateien = (stats.dateien ?? 0) + dateien
    if (fassungen) stats.fassungen = (stats.fassungen ?? 0) + fassungen
    materialIds.push(materialId)
    stats.materialien = (stats.materialien ?? 0) + 1
    return materialId
  }

  let lehrwerkId: string | null = null
  const priorLehrwerk = prior.latest.get('lehrwerk')
  if (mapping.createLehrwerk && mapping.lehrwerkId) {
    try {
      const existing = await getMaterialDetail(mapping.lehrwerkId)
      if (!existing || existing.materialType !== 'lehrwerk') {
        throw invalidInput('Das gewählte Lehrwerk wurde nicht gefunden.')
      }
      lehrwerkId = existing.id
      mapping.lehrwerkId = lehrwerkId
      // Beim Nachholen ist das Lehrwerk schon vermerkt (auch ein in diesem Stapel angelegtes).
      if (priorLehrwerk?.entityId !== lehrwerkId) {
        await track('lehrwerk', lehrwerkId, 'verknuepft', 'Bestehendes Lehrwerk')
      }
    } catch (error) {
      const message = oeffentlicheFehlermeldung(error, 'Das Lehrwerk konnte nicht zugeordnet werden.')
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
      errors.push({ sourceRef: 'lehrwerk', message })
      await track('lehrwerk', null, 'fehlgeschlagen', message)
    }
  }

  // Cover-Fallback: Hat das Lehrwerk keine Buchdatei (z. B. CD-ROM), dient ein `cover.*` im Stapel als
  // Cover. Es wird dann Hauptdatei des Lehrwerks und nicht zusätzlich als Bild-Material angelegt.
  let coverRef: string | null = null
  if (lehrwerkId) {
    const coverFile = findLehrwerkCover(
      files.map((file) => ({
        sourceRef: file.sourceRef,
        fileName: file.fileName,
        relativePath: file.relativePath,
        extension: extensionOf(file.fileName),
      })),
    )
    const cover = coverFile ? filesByRef.get(coverFile.sourceRef) : undefined
    if (cover && prior.latest.get('lehrwerk-cover')?.action === 'verknuepft') {
      coverRef = cover.sourceRef
    } else if (cover) {
      try {
        const detail = await getMaterialDetail(lehrwerkId)
        const hatBuchdatei = (detail?.variants ?? []).some((variant) =>
          variant.assets.some((asset) => asset.role === 'haupt'),
        )
        if (detail && !hatBuchdatei) {
          if (cover.stagingMissing || !cover.stagingPath || !(await fileExists(cover.stagingPath))) {
            throw invalidInput(`Das Cover „${cover.fileName}“ liegt nicht mehr vor.`)
          }
          await attachStagedAsset(await defaultVariantId(lehrwerkId), cover, 'haupt')
          stats.dateien = (stats.dateien ?? 0) + 1
          coverRef = cover.sourceRef
          await track('lehrwerk-cover', lehrwerkId, 'verknuepft', `Cover: ${cover.fileName}`)
        }
      } catch (error) {
        // Ohne Cover bleibt das Bild ein normales Material; der Rest des Stapels läuft weiter.
        await addLog(
          runId,
          'warnung',
          `Cover „${cover.fileName}“ nicht übernommen: ${oeffentlicheFehlermeldung(error, 'Das Cover konnte nicht gespeichert werden.')}`,
        )
      }
    }
  }

  // Stationenarbeit: Aus den erkannten Blättern wird ein Über-Material, das statt der einzelnen
  // Blätter am Lehrwerk hängt. Die Blätter gehören dann nur dem Lernzirkel an.
  // Beim Nachholen hängen weitere Stationen am schon angelegten Lernzirkel.
  const lernzirkelIds = new Map<string, string>(prior.lernzirkelIds)
  const lernzirkelGruppen = new Map<string, { ref: BulkLernzirkelRef; stationen: number }>()
  for (const cluster of clusters) {
    if (!cluster.lernzirkel || lernzirkelIds.has(cluster.lernzirkel.id)) continue
    if (prior.createdClusters.has(cluster.clusterId)) continue
    if (decisionForCluster(cluster, mapping)?.include === false) continue
    const gruppe = lernzirkelGruppen.get(cluster.lernzirkel.id)
    if (gruppe) gruppe.stationen += 1
    else lernzirkelGruppen.set(cluster.lernzirkel.id, { ref: cluster.lernzirkel, stationen: 1 })
  }
  for (const [groupId, gruppe] of lernzirkelGruppen) {
    const entscheidung = mapping.lernzirkel?.[groupId]
    if (entscheidung?.enabled === false || gruppe.stationen < 2) continue
    const lernzirkelTitel = (entscheidung?.title ?? gruppe.ref.title).trim()
    if (!lernzirkelTitel) continue
    try {
      const lernzirkelId = await createMaterial(
        {
          title: lernzirkelTitel,
          description: `Stationenarbeit mit ${gruppe.stationen} Bündeln aus dem Stapel-Upload.`,
          materialType: 'lernzirkel',
          origin: 'manuell',
          schoolForm: mapping.schoolForm ?? null,
          subjectIds: subjectId ? [subjectId] : [],
          gradeLevels,
        },
        userId,
      )
      lernzirkelIds.set(groupId, lernzirkelId)
      materialIds.push(lernzirkelId)
      stats.materialien = (stats.materialien ?? 0) + 1
      stats.lernzirkel = (stats.lernzirkel ?? 0) + 1
      await track(`lernzirkel:${groupId}`, lernzirkelId, 'erstellt', 'Lernzirkel')
      if (lehrwerkId) {
        await addRelation(lernzirkelId, lehrwerkId, 'gehoert_zu', 'Lehrwerk-Paket')
        stats.verknuepft = (stats.verknuepft ?? 0) + 1
      }
    } catch (error) {
      // Ohne Lernzirkel-Material hängen die Blätter wie bisher einzeln am Lehrwerk.
      await addLog(
        runId,
        'warnung',
        `Lernzirkel „${lernzirkelTitel}“ nicht angelegt: ${oeffentlicheFehlermeldung(error, 'Der Lernzirkel konnte nicht angelegt werden.')}`,
      )
    }
  }

  for (const cluster of clusters) {
    if (prior.createdClusters.has(cluster.clusterId)) continue
    const decision = decisionForCluster(cluster, mapping)
    if (coverRef && cluster.fileRefs.length === 1 && cluster.fileRefs[0] === coverRef) {
      if (prior.latest.get(cluster.clusterId)?.action !== 'uebersprungen') {
        await track(cluster.clusterId, null, 'uebersprungen', 'Als Lehrwerk-Cover verwendet')
      }
      continue
    }
    if (decision?.include === false) {
      if (prior.latest.get(cluster.clusterId)?.action === 'uebersprungen') continue
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
    const fassungFiles = clusterFiles.filter((file) => roles[file.sourceRef] === 'fassung')
    let primaryFiles = schueler
    let solutionFiles = loesungen
    if (!primaryFiles.length && solutionFiles.length) {
      primaryFiles = solutionFiles
      solutionFiles = []
    }
    if (!primaryFiles.length) {
      primaryFiles = clusterFiles.filter(
        (file) => roles[file.sourceRef] !== 'anhaengsel' && roles[file.sourceRef] !== 'fassung',
      )
    }
    if (!primaryFiles.length && fassungFiles.length) {
      // Nur Fassungen gewählt: die erste wird zum Material, die übrigen bleiben Fassungen davon.
      primaryFiles = [fassungFiles.shift()!]
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
      // Vor dem Anlegen prüfen, damit kein Material ohne seine Dateien entsteht.
      for (const file of clusterFiles) {
        if (file.stagingMissing || !file.stagingPath || !(await fileExists(file.stagingPath))) {
          throw invalidInput(
            `Die Datei „${file.fileName}“ liegt nicht mehr vor. Bitte den Stapel neu hochladen.`,
          )
        }
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
          fassungen: fassungFiles,
        })
        primaryByCluster.set(cluster.clusterId, primaryId)
        createdNow.add(cluster.clusterId)
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
          createdNow.add(cluster.clusterId)
        }
      }

      const primaerId = primaryByCluster.get(cluster.clusterId)
      const lernzirkelId = cluster.lernzirkel ? lernzirkelIds.get(cluster.lernzirkel.id) : undefined
      if (primaerId && lernzirkelId) {
        await addRelation(primaerId, lernzirkelId, 'gehoert_zu', 'Station im Lernzirkel')
        stats.verknuepft = (stats.verknuepft ?? 0) + 1
      } else if (lehrwerkId && primaerId) {
        await addRelation(primaerId, lehrwerkId, 'gehoert_zu', 'Lehrwerk-Paket')
        stats.verknuepft = (stats.verknuepft ?? 0) + 1
      }
    } catch (error) {
      const message = oeffentlicheFehlermeldung(error, 'Die Datei konnte nicht übernommen werden.')
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
      // Verknüpfungen zwischen früher angelegten Bündeln bestehen schon.
      if (!createdNow.has(cluster.clusterId) && !createdNow.has(link.targetClusterId)) continue
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

  // Übersprungen und fehlgeschlagen ergeben sich aus dem letzten Ergebnis je Bündel –
  // so zählt ein nachgeholtes Bündel nicht mehr als fehlgeschlagen.
  const after = summarizeRunItems(await activeRunItems(runId))
  let uebersprungen = 0
  let fehlgeschlagen = after.latest.get('lehrwerk')?.action === 'fehlgeschlagen' ? 1 : 0
  for (const cluster of clusters) {
    const outcome = clusterOutcome(cluster.clusterId, after)
    if (outcome === 'uebersprungen') uebersprungen += 1
    else if (outcome === 'fehlgeschlagen') fehlgeschlagen += 1
  }
  const previous: BulkUploadStats = isRetry
    ? ((run.stats as unknown as BulkUploadStats | null) ?? {})
    : {}
  const summe = (key: keyof BulkUploadStats) => (previous[key] ?? 0) + (stats[key] ?? 0)
  const total: BulkUploadStats = {
    materialien: after.createdMaterialIds.size,
    dateien: summe('dateien'),
    verknuepft: summe('verknuepft'),
    ...(summe('fassungen') ? { fassungen: summe('fassungen') } : {}),
    ...(summe('lernzirkel') ? { lernzirkel: summe('lernzirkel') } : {}),
    uebersprungen,
    fehlgeschlagen,
  }

  const status: BulkCommitResult['status'] =
    fehlgeschlagen === 0
      ? 'importiert'
      : (total.materialien ?? 0) > 0
        ? 'teilweise_importiert'
        : 'fehlgeschlagen'

  await db
    .update(importRuns)
    .set({
      status,
      stats: total as ImportStats,
      finishedAt: new Date(),
      errorMessage: null,
      stagingPath: null,
      mapping: mapping as never,
    })
    .where(eq(importRuns.id, runId))

  await addLog(
    runId,
    status === 'importiert' ? 'info' : 'warnung',
    isRetry
      ? `Erneut angelegt: ${materialIds.length} Materialien neu, ${fehlgeschlagen} weiterhin fehlgeschlagen.`
      : `Stapel abgeschlossen: ${total.materialien} Materialien, ${total.verknuepft ?? 0} Verknüpfungen, ${uebersprungen} übersprungen, ${fehlgeschlagen} fehlgeschlagen.`,
  )

  await waitForIndex()
  log.info('Stapel-Upload committed', { runId, status, stats: total, retry: isRetry })
  return { runId, status, stats: total, errors, materialIds }
}

/**
 * Legt die Dateien angelegter Materialien wieder in den Zwischenspeicher, bevor das
 * Rückgängigmachen sie löscht. So bleiben Analyse und Entscheidungen nutzbar.
 * Zuordnung über die Prüfsumme; Dateien, die noch im Zwischenspeicher liegen, bleiben.
 */
async function restoreFilesToStaging(
  files: BulkUploadDetectedFile[],
  materialIds: string[],
): Promise<{ files: BulkUploadDetectedFile[]; restored: number; missing: Set<string> }> {
  const assets = materialIds.length
    ? await useDatabase()
        .select({
          storageKey: materialAssets.storageKey,
          checksum: materialAssets.checksum,
          fileName: materialAssets.fileName,
          extractedText: materialAssets.extractedText,
        })
        .from(materialAssets)
        .innerJoin(materialVariants, eq(materialVariants.id, materialAssets.variantId))
        .where(inArray(materialVariants.materialId, materialIds))
    : []
  const byChecksum = new Map<string, typeof assets>()
  for (const asset of assets) {
    if (!asset.checksum || !asset.storageKey) continue
    byChecksum.set(asset.checksum, [...(byChecksum.get(asset.checksum) ?? []), asset])
  }

  const missing = new Set<string>()
  let restored = 0
  const result: BulkUploadDetectedFile[] = []
  for (const file of files) {
    if (!file.stagingMissing && file.stagingPath && (await fileExists(file.stagingPath))) {
      result.push(file)
      continue
    }
    // Gleichnamige Datei zuerst, falls derselbe Inhalt mehrfach im Stapel lag.
    const candidates = [...(byChecksum.get(file.checksum) ?? [])].sort(
      (a, b) => Number(b.fileName === file.fileName) - Number(a.fileName === file.fileName),
    )
    let copy: BulkUploadDetectedFile | null = null
    for (const asset of candidates) {
      let stagingPath: string | null = null
      try {
        const buffer = await readFile(resolveStoragePath(asset.storageKey!))
        stagingPath = await storeStagingFile(buffer, file.fileName)
        const text = asset.extractedText?.trim() ? asset.extractedText : null
        copy = {
          ...file,
          stagingPath,
          stagingMissing: false,
          extractedTextKey: text ? await storeExtractedTextSidecar(stagingPath, text) : null,
        }
        break
      } catch (error) {
        if (stagingPath) await deleteStagedFiles([{ ...file, stagingPath, extractedTextKey: null }])
        log.warn('Datei konnte nicht in den Zwischenspeicher zurückgelegt werden', {
          fileName: file.fileName,
          error,
        })
      }
    }
    if (copy) {
      restored += 1
      result.push(copy)
    } else {
      missing.add(file.sourceRef)
      result.push({ ...file, stagingMissing: true, extractedTextKey: null })
    }
  }
  return { files: result, restored, missing }
}

export interface BulkUndoResult {
  removed: BulkUploadStats
  /** Dateien, die wieder im Zwischenspeicher liegen. */
  restoredFiles: number
  /** Bündel, die mangels Datei nicht erneut angelegt werden können (abgewählt). */
  missingClusters: number
}

/**
 * Entfernt die angelegten Materialien und setzt den Stapel zurück auf die Vorschau –
 * mit Analyse, KI-Vorschlägen und allen Entscheidungen, damit er sich korrigiert erneut anlegen lässt.
 */
export async function undoBulkUpload(runId: string): Promise<BulkUndoResult> {
  const run = await requireBulkRun(runId)
  if (!['importiert', 'teilweise_importiert'].includes(run.status)) {
    throw appError(
      'KONFLIKT',
      run.undoneAt
        ? 'Dieser Stapel wurde bereits rückgängig gemacht.'
        : 'Nur abgeschlossene Stapel können rückgängig gemacht werden.',
    )
  }

  const db = useDatabase()
  const items = await activeRunItems(runId)
  const progress = summarizeRunItems(items)
  const detected = (run.detected ?? {}) as unknown as BulkUploadDetected
  const mapping: BulkUploadMapping = {
    ...((run.mapping as unknown as BulkUploadMapping | null) ?? {}),
    records: { ...(((run.mapping as unknown as BulkUploadMapping | null)?.records) ?? {}) },
  }

  // Erst kopieren, dann löschen: deleteMaterial entfernt die gespeicherten Dateien.
  const { files, restored, missing } = await restoreFilesToStaging(detected.files ?? [], [
    ...progress.createdMaterialIds,
  ])

  const removed: BulkUploadStats = { materialien: 0 }
  const seen = new Set<string>()
  for (const item of [...items].reverse()) {
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

  // Ein in diesem Stapel angelegtes Lehrwerk ist jetzt weg; beim nächsten Anlegen neu erzeugen.
  if (progress.latest.get('lehrwerk')?.action === 'erstellt') mapping.lehrwerkId = null

  let missingClusters = 0
  const clusters = resolveClusters(detected).map((cluster) => {
    const fehlend = files.filter(
      (file) => missing.has(file.sourceRef) && cluster.fileRefs.includes(file.sourceRef),
    )
    if (!fehlend.length) return cluster
    missingClusters += 1
    mapping.records![cluster.clusterId] = {
      ...(decisionForCluster(cluster, mapping) ?? {}),
      include: false,
    }
    const warnings = fehlend
      .map(
        (file) =>
          `Datei „${file.fileName}“ liegt nicht mehr vor – Bündel abgewählt. Bitte bei Bedarf neu hochladen.`,
      )
      .filter((warning) => !cluster.warnings.includes(warning))
    return { ...cluster, warnings: [...cluster.warnings, ...warnings] }
  })

  // Die Einträge bleiben fürs Protokoll, zählen aber nicht mehr zum aktuellen Durchgang.
  await db
    .update(importRunItems)
    .set({
      payload: sql`coalesce(${importRunItems.payload}, '{}'::jsonb) || ${JSON.stringify({ [UNDONE_PAYLOAD_KEY]: true })}::jsonb`,
    })
    .where(eq(importRunItems.runId, runId))
  await db
    .update(importRuns)
    .set({
      status: 'vorschau',
      undoneAt: new Date(),
      finishedAt: null,
      errorMessage: null,
      stats: {},
      stagingPath: files.find((file) => !file.stagingMissing)?.stagingPath ?? null,
      detected: { ...detected, files, clusters } satisfies BulkUploadDetected as never,
      mapping: mapping as never,
    })
    .where(eq(importRuns.id, runId))
  await addLog(
    runId,
    'info',
    `Stapel rückgängig gemacht: ${removed.materialien} Materialien entfernt. Die Vorschau ist wieder bearbeitbar und kann erneut angelegt werden.`,
  )
  if (missingClusters) {
    await addLog(
      runId,
      'warnung',
      `${missing.size} Datei${missing.size === 1 ? '' : 'en'} nicht mehr vorhanden; ${missingClusters} Bündel abgewählt.`,
    )
  }
  log.info('Stapel-Upload rückgängig gemacht', { runId, removed, restored, missing: missing.size })

  return { removed, restoredFiles: restored, missingClusters }
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
  canCancel: boolean
  canDiscard: boolean
  canUndo: boolean
  /** Ergebnis je Bündel nach dem Anlegen; fehlt, solange das Bündel offen ist. */
  clusterOutcomes: Record<string, { outcome: BulkClusterOutcome; message: string | null }>
  /** Noch nicht angelegte Bündel, deren Dateien bereitliegen. */
  retryableClusterIds: string[]
  /** Teilweise übernommen: die noch nicht angelegten Bündel lassen sich erneut anlegen. */
  canRetry: boolean
  /** Übernommen, aber Dateien nicht angelegter Bündel liegen noch im Zwischenspeicher. */
  canDiscardLeftovers: boolean
  /** Bündel, für die die KI keine Vorschläge geliefert hat. */
  kiOhneVorschlag: number
  /** Fortschritt, solange fehlende KI-Vorschläge nachgeholt werden. */
  kiNachholen: KiNachholFortschritt | null
  canKiNachholen: boolean
}

export async function getBulkRunOverview(runId: string): Promise<BulkRunOverview> {
  const run = await requireBulkRun(runId)
  const detected = (run.detected ?? {}) as unknown as BulkUploadDetected
  const analysisPending = Boolean(detected.analysisPending)
  const files = detected.files ?? []
  const clusters = analysisPending ? [] : resolveClusters(detected)
  const progress = summarizeRunItems(analysisPending ? [] : await activeRunItems(runId))
  const clusterOutcomes: BulkRunOverview['clusterOutcomes'] = {}
  for (const cluster of clusters) {
    const outcome = clusterOutcome(cluster.clusterId, progress)
    if (outcome) {
      clusterOutcomes[cluster.clusterId] = {
        outcome,
        message: progress.latest.get(cluster.clusterId)?.message ?? null,
      }
    }
  }
  const imported = run.status === 'importiert' || run.status === 'teilweise_importiert'
  const retryable = imported
    ? retryableClusterIds(clusters, new Map(files.map((file) => [file.sourceRef, file])), progress)
    : []

  const kiNachholen = kiNachholenFortschritt(runId)
  const kiOhneVorschlag = clusters.filter((cluster) => !cluster.suggestions.aiUsed).length

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
    canCommit: (run.status === 'vorschau' || run.status === 'analysiert') && !kiNachholen,
    canCancel: isAnalysisRunning(run.status, detected),
    canDiscard: DISCARDABLE_STATUSES.includes(run.status) || isAnalysisRunning(run.status, detected),
    canUndo: imported,
    clusterOutcomes,
    retryableClusterIds: retryable,
    canRetry: run.status === 'teilweise_importiert' && retryable.length > 0,
    canDiscardLeftovers: retryable.length > 0,
    kiOhneVorschlag,
    kiNachholen,
    canKiNachholen:
      run.status === 'vorschau' && Boolean(detected.aiEnabled) && kiOhneVorschlag > 0 && !kiNachholen,
  }
}

/** Felder eines Eintrags, die aus dem KI-Vorschlag kommen. */
function recordAusVorschlag(suggestions: BulkUploadDetectedCluster['suggestions']) {
  return {
    title: suggestions.title,
    materialType: suggestions.materialType,
    description: suggestions.description,
    tagNames: suggestions.tagNames,
    learningObjectives: suggestions.learningObjectives ?? [],
    content: suggestions.contentSummary ?? '',
  }
}

function gleicherWert(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * Fordert KI-Vorschläge für die Bündel neu an, bei denen die KI in der Analyse
 * nichts geliefert hat – etwa weil ein Denkmodell sein Ausgabebudget aufgebraucht
 * hat. Läuft im Hintergrund; Bearbeiten und Anlegen sind solange gesperrt.
 */
export async function startKiNachholen(runId: string): Promise<{ gesamt: number }> {
  const run = await requireBulkRun(runId)
  if (run.status !== 'vorschau') {
    throw appError('KONFLIKT', 'KI-Vorschläge lassen sich nur in der Vorschau nachholen.')
  }
  if (kiNachholenFortschritt(runId)) {
    throw appError('KONFLIKT', 'Die KI-Vorschläge werden bereits nachgeholt.')
  }
  const settings = await getAiSettings()
  if (!settings.enabled) {
    throw appError('KI_NICHT_KONFIGURIERT', 'Die KI-Unterstützung ist nicht aktiviert.')
  }

  const detected = (run.detected ?? {}) as unknown as BulkUploadDetected
  const offen = resolveClusters(detected)
    .filter((cluster) => !cluster.suggestions.aiUsed)
    .map((cluster) => cluster.clusterId)
  if (!offen.length) return { gesamt: 0 }

  const fortschritt = registerKiNachholen(runId, offen.length)
  void kiNachholenAusfuehren(runId, offen, settings, fortschritt)
    .catch((error) => log.warn('KI-Vorschläge konnten nicht nachgeholt werden', { runId, error }))
    .finally(() => unregisterKiNachholen(runId))
  return { gesamt: offen.length }
}

async function kiNachholenAusfuehren(
  runId: string,
  clusterIds: string[],
  settings: AiSettings,
  fortschritt: KiNachholFortschritt,
): Promise<void> {
  const run = await requireBulkRun(runId)
  const detected = (run.detected ?? {}) as unknown as BulkUploadDetected
  const mapping = (run.mapping as unknown as BulkUploadMapping | null) ?? {}
  const files = detected.files ?? []
  const filesByRef = new Map(files.map((file) => [file.sourceRef, file]))
  const clusters = resolveClusters(detected)
  const offen = new Set(clusterIds)
  const subjectLabel = await resolveSubjectLabel(mapping)

  await addLog(runId, 'info', `KI-Vorschläge für ${clusterIds.length} Bündel werden nachgeholt …`)
  const vorher = new Map<string, BulkUploadDetectedCluster['suggestions']>()
  const neu = new Set<string>()
  await mapLimit(
    clusters.filter((cluster) => offen.has(cluster.clusterId)),
    BULK_AI_CONCURRENCY,
    async (cluster) => {
      vorher.set(cluster.clusterId, cluster.suggestions)
      if (await clusterKiVorschlag(cluster, filesByRef, mapping, subjectLabel, settings)) {
        neu.add(cluster.clusterId)
      }
      fortschritt.fertig += 1
    },
  )

  // Frischen Stand lesen: Nur Felder ersetzen, die noch dem alten Vorschlag entsprechen.
  const [aktuell] = await useDatabase().select().from(importRuns).where(eq(importRuns.id, runId)).limit(1)
  if (!aktuell || aktuell.status !== 'vorschau') return
  const aktuellesMapping: BulkUploadMapping = {
    ...((aktuell.mapping as unknown as BulkUploadMapping | null) ?? {}),
  }
  const records = { ...(aktuellesMapping.records ?? {}) }
  for (const cluster of clusters) {
    if (!neu.has(cluster.clusterId)) continue
    const alt = recordAusVorschlag(vorher.get(cluster.clusterId)!)
    const vorschlag = recordAusVorschlag(cluster.suggestions)
    const record = records[cluster.clusterId]
    if (record) {
      const ersetzt = { ...record }
      for (const feld of Object.keys(vorschlag) as (keyof typeof vorschlag)[]) {
        const wert = record[feld]
        if (wert === undefined || gleicherWert(wert, alt[feld]) || (Array.isArray(wert) && !wert.length) || wert === '') {
          ;(ersetzt as Record<string, unknown>)[feld] = vorschlag[feld]
        }
      }
      records[cluster.clusterId] = ersetzt
    }
    for (const ref of cluster.fileRefs) {
      const file = filesByRef.get(ref)
      if (file) file.suggestions = cluster.suggestions
    }
  }
  aktuellesMapping.records = records

  const aiErrors = clusters.filter((cluster) => !cluster.suggestions.aiUsed).length
  await useDatabase()
    .update(importRuns)
    .set({
      detected: { ...detected, files, clusters, aiErrors } as never,
      mapping: aktuellesMapping as never,
    })
    .where(and(eq(importRuns.id, runId), eq(importRuns.status, 'vorschau')))

  const fehlend = clusterIds.length - neu.size
  await addLog(
    runId,
    fehlend ? 'warnung' : 'info',
    fehlend
      ? `KI-Vorschläge für ${neu.size} von ${clusterIds.length} Bündeln nachgeholt; ${fehlend} weiterhin ohne KI.`
      : `KI-Vorschläge für alle ${clusterIds.length} Bündel nachgeholt.`,
  )
  log.info('KI-Vorschläge nachgeholt', { runId, angefragt: clusterIds.length, erhalten: neu.size })
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

// `rueckgaengig`: Stapel, die vor dem Wiederherstellen der Dateien rückgängig gemacht wurden.
const DISCARDABLE_STATUSES = ['vorschau', 'analysiert', 'fehlgeschlagen', 'rueckgaengig']

/** Analyse noch nicht fertig: abbrechbar und verwerfbar – egal ob ein Worker noch lebt. */
function isAnalysisRunning(status: string, detected: BulkUploadDetected): boolean {
  return status === 'laeuft' && Boolean(detected.analysisPending)
}

export async function discardBulkUpload(runId: string): Promise<void> {
  const run = await requireBulkRun(runId)
  const detected = (run.detected ?? {}) as unknown as BulkUploadDetected
  const analysisRunning = isAnalysisRunning(run.status, detected)
  if (!DISCARDABLE_STATUSES.includes(run.status) && !analysisRunning) {
    throw appError('KONFLIKT', 'Nur offene Stapel können verworfen werden.')
  }

  // Ein Worker in diesem Prozess hört sofort auf; einer in einem anderen Prozess
  // merkt am fehlenden Stapel, dass er aufhören und hinter sich aufräumen soll.
  if (analysisRunning) abortAnalysis(runId)

  await useDatabase().delete(importRuns).where(eq(importRuns.id, runId))
  await deleteStagedFiles(detected.files ?? [])
}

/**
 * Entfernt bei einem übernommenen Stapel die Dateien der nicht angelegten Bündel aus dem
 * Zwischenspeicher. Angelegte Materialien und der Stapel selbst bleiben (auch rückgängig machbar).
 */
export async function discardBulkLeftovers(runId: string): Promise<{ files: number }> {
  const run = await requireBulkRun(runId)
  if (run.status !== 'importiert' && run.status !== 'teilweise_importiert') {
    throw appError('KONFLIKT', 'Nur bei übernommenen Stapeln lassen sich übrige Dateien verwerfen.')
  }
  const detected = (run.detected ?? {}) as unknown as BulkUploadDetected
  const files = detected.files ?? []
  const leftovers = files.filter((file) => !file.stagingMissing)
  // Angelegte Dateien liegen nicht mehr im Zwischenspeicher; Löschen ist dort ein No-op.
  await deleteStagedFiles(leftovers)
  const progress = summarizeRunItems(await activeRunItems(runId))
  const uebrig = resolveClusters(detected).filter(
    (cluster) => !progress.createdClusters.has(cluster.clusterId),
  ).length

  await useDatabase()
    .update(importRuns)
    .set({
      detected: {
        ...detected,
        files: files.map((file) => ({ ...file, stagingMissing: true, extractedTextKey: null })),
      } satisfies BulkUploadDetected as never,
      stagingPath: null,
    })
    .where(eq(importRuns.id, runId))
  await addLog(
    runId,
    'info',
    `Übrige Dateien verworfen: ${uebrig} Bündel werden nicht mehr angelegt. Angelegte Materialien bleiben.`,
  )
  return { files: leftovers.length }
}

/** Bricht eine laufende Analyse ab; der Stapel bleibt als `fehlgeschlagen` verwerfbar stehen. */
export async function cancelBulkUpload(runId: string): Promise<void> {
  const run = await requireBulkRun(runId)
  const detected = (run.detected ?? {}) as unknown as BulkUploadDetected
  if (!isAnalysisRunning(run.status, detected)) {
    throw appError('KONFLIKT', 'Nur eine laufende Analyse kann abgebrochen werden.')
  }

  const message = 'Die Analyse wurde abgebrochen. Der Stapel kann verworfen werden.'
  const [updated] = await useDatabase()
    .update(importRuns)
    .set({
      status: 'fehlgeschlagen',
      errorMessage: message,
      finishedAt: new Date(),
      detected: { ...detected, analysisPending: false } as never,
    })
    .where(and(eq(importRuns.id, runId), eq(importRuns.status, 'laeuft')))
    .returning({ id: importRuns.id })
  if (!updated) throw appError('KONFLIKT', 'Die Analyse ist bereits beendet.')

  abortAnalysis(runId)
  await addLog(runId, 'warnung', 'Analyse abgebrochen.')
  log.info('Stapel-Analyse abgebrochen', { runId })
}

/**
 * Schließt einen Stapel ab, der in `laeuft` stehen geblieben ist (siehe decideOrphanRecovery).
 * Gibt `true` zurück, wenn der Stapel geändert wurde.
 */
async function recoverInterruptedRun(runId: string, reason: 'neustart' | 'fehler'): Promise<boolean> {
  const db = useDatabase()
  const [run] = await db.select().from(importRuns).where(eq(importRuns.id, runId)).limit(1)
  if (!run || run.status !== 'laeuft') return false
  const detected = (run.detected ?? {}) as unknown as BulkUploadDetected
  const analysisPending = Boolean(detected.analysisPending)

  const items = await activeRunItems(runId)
  const created = new Set(
    items
      .filter((item) => item.action === 'erstellt' && item.entityType === 'material' && item.entityId)
      .map((item) => item.entityId),
  )
  const count = (action: string) => items.filter((item) => item.action === action).length

  const decision = decideOrphanRecovery({
    analysisPending,
    createdMaterials: created.size,
    reason,
  })

  const [updated] = await db
    .update(importRuns)
    .set({
      status: decision.status,
      errorMessage: decision.errorMessage,
      finishedAt: new Date(),
      detected: { ...detected, analysisPending: false } as never,
      ...(analysisPending
        ? {}
        : {
            stats: {
              materialien: created.size,
              verknuepft: count('verknuepft'),
              uebersprungen: count('uebersprungen'),
              fehlgeschlagen: count('fehlgeschlagen'),
            } as ImportStats,
          }),
      ...(decision.discardStaging ? { stagingPath: null } : {}),
    })
    .where(and(eq(importRuns.id, runId), eq(importRuns.status, 'laeuft')))
    .returning({ id: importRuns.id })
  if (!updated) return false

  if (decision.discardStaging) await deleteStagedFiles(detected.files ?? [])
  await addLog(runId, 'fehler', decision.errorMessage)
  log.warn('Unterbrochenen Stapel abgeschlossen', {
    runId,
    reason,
    status: decision.status,
    materialien: created.size,
  })
  return true
}

/**
 * Beim Serverstart: Stapel, die der vorige Prozess in `laeuft` hinterlassen hat, abschließen.
 * Analyse und Übernahme laufen nur im Prozess, nichts setzt sie nach einem Neustart fort.
 */
export async function recoverOrphanedBulkRuns(): Promise<number> {
  const runs = await useDatabase()
    .select({ id: importRuns.id })
    .from(importRuns)
    .where(and(eq(importRuns.adapterId, BULK_PDF_ADAPTER_ID), eq(importRuns.status, 'laeuft')))

  let recovered = 0
  for (const { id } of runs) {
    // Schon in diesem Prozess gestartet (Anfrage während des Bootstraps) – nicht verwaist.
    if (isRunActive(id)) continue
    try {
      if (await recoverInterruptedRun(id, 'neustart')) recovered += 1
    } catch (error) {
      log.warn('Verwaister Stapel konnte nicht abgeschlossen werden', { runId: id, error })
    }
  }
  return recovered
}

/** Für die Schulportal-Importliste: Stapel-Uploads und KI-Einzelanlagen ausblenden. */
export function excludeBulkAdapterSql() {
  return and(
    ne(importRuns.adapterId, BULK_PDF_ADAPTER_ID),
    ne(importRuns.adapterId, AI_CREATE_ADAPTER_ID),
  )
}

export { BULK_PDF_ADAPTER_ID, BULK_PDF_ADAPTER_LABEL }
