import { readFile } from 'node:fs/promises'
import { desc, eq, ne, sql } from 'drizzle-orm'
import { normalizeGradeLevel } from '#shared/utils/jahrgangsstufen'
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
import { addFileAsset, createMaterial, deleteMaterial } from '../material.service'
import { extractText } from '../extraction.service'
import { getAiSettings } from '../settings.service'
import {
  deleteFile,
  extensionOf,
  formatBytes,
  resolveStoragePath,
  sanitizeFileName,
  storeStagingFile,
  validateUpload,
} from '../storage.service'
import { getOrCreateSubject } from '../taxonomy.service'
import { waitForIndex } from '../search/indexer'
import { suggestFileMetadata, titleFromFileName } from './suggest-metadata'
import {
  BULK_PDF_ADAPTER_ID,
  BULK_PDF_ADAPTER_LABEL,
  BULK_PDF_ADAPTER_VERSION,
  MAX_BULK_FILES,
  type BulkUploadDetected,
  type BulkUploadDetectedFile,
  type BulkUploadMapping,
  type BulkUploadStats,
} from './types'

const log = createLogger('bulk-upload')

export interface BulkUploadInputFile {
  buffer: Buffer
  fileName: string
}

function isBulkRun(adapterId: string): boolean {
  return adapterId === BULK_PDF_ADAPTER_ID
}

async function requireBulkRun(runId: string) {
  const [run] = await useDatabase().select().from(importRuns).where(eq(importRuns.id, runId)).limit(1)
  if (!run) throw notFound('Der Stapel-Upload')
  if (!isBulkRun(run.adapterId)) {
    throw appError('UNGUELTIGE_EINGABE', 'Dieser Vorgang ist kein PDF-Stapel-Upload.')
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

/**
 * Nimmt mehrere PDFs entgegen, speichert sie zwischen, extrahiert Text
 * und erzeugt Metadaten-Vorschläge (KI oder Dateiname).
 */
export async function analyzeBulkPdfUpload(
  files: BulkUploadInputFile[],
  userId: string | null,
  mappingInput: BulkUploadMapping = {},
): Promise<{ runId: string; fileCount: number; aiEnabled: boolean }> {
  if (!files.length) throw invalidInput('Bitte mindestens eine PDF-Datei auswählen.')
  if (files.length > MAX_BULK_FILES) {
    throw invalidInput(`Maximal ${MAX_BULK_FILES} Dateien pro Stapel sind erlaubt.`)
  }

  const pdfFiles: BulkUploadInputFile[] = []
  for (const file of files) {
    const name = sanitizeFileName(file.fileName)
    if (extensionOf(name) !== 'pdf') {
      throw invalidInput(`Nur PDF-Dateien sind erlaubt („${name}“).`)
    }
    await validateUpload(file.buffer, name)
    pdfFiles.push({ buffer: file.buffer, fileName: name })
  }

  const mapping: BulkUploadMapping = {
    subjectId: mappingInput.subjectId ?? null,
    subjectName: mappingInput.subjectName ?? '',
    gradeLevel: normalizeGradeLevel(mappingInput.gradeLevel) ?? null,
    schoolForm: mappingInput.schoolForm ?? null,
    defaultMaterialType: mappingInput.defaultMaterialType ?? 'arbeitsblatt',
    linkDuplicates: mappingInput.linkDuplicates ?? true,
    records: {},
  }

  const settings = await getAiSettings()
  const subjectLabel = await resolveSubjectLabel(mapping)
  const checksums = pdfFiles.map((f) => sha256(f.buffer))
  const duplicates = await findAttachmentDuplicates(checksums)

  const detectedFiles: BulkUploadDetectedFile[] = []
  let aiErrors = 0
  const stagingPaths: string[] = []

  try {
    for (let index = 0; index < pdfFiles.length; index++) {
      const file = pdfFiles[index]!
      const checksum = checksums[index]!
      const stagingPath = await storeStagingFile(file.buffer, file.fileName)
      stagingPaths.push(stagingPath)

      const extraction = await extractText(file.buffer, file.fileName)
      const hasText = Boolean(extraction.text.trim())
      const warnings: string[] = []

      if (!hasText) {
        warnings.push('Keine Textebene gefunden (vermutlich Scan). Titel ggf. manuell prüfen.')
      }
      if (!titleFromFileName(file.fileName)) {
        warnings.push('Leerer Titel nach Bereinigung des Dateinamens.')
      }

      const duplicate = duplicates.get(checksum)
      if (duplicate) {
        warnings.push(`Mögliche Dublette: „${duplicate.title}“.`)
      }

      let suggestions
      try {
        suggestions = await suggestFileMetadata({
          fileName: file.fileName,
          extractedText: extraction.text,
          mapping,
          subjectLabel,
          settings,
        })
      } catch {
        suggestions = await suggestFileMetadata({
          fileName: file.fileName,
          extractedText: '',
          mapping,
          subjectLabel,
          settings: { ...settings, enabled: false },
        })
        aiErrors += 1
      }

      if (settings.enabled && hasText && !suggestions.aiUsed) aiErrors += 1
      if (!suggestions.title.trim()) {
        warnings.push('Leerer Titel – bitte vor dem Anlegen ergänzen.')
      }

      const sourceRef = `pdf:${index}:${checksum.slice(0, 12)}`
      detectedFiles.push({
        sourceRef,
        fileName: file.fileName,
        sizeBytes: file.buffer.length,
        checksum,
        stagingPath,
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
        suggestions,
        warnings,
      })

      const skipDuplicate = Boolean(duplicate) && mapping.linkDuplicates !== false
      mapping.records![sourceRef] = {
        include: !skipDuplicate,
        title: suggestions.title,
        materialType: suggestions.materialType,
        description: suggestions.description,
        tagNames: suggestions.tagNames,
        action: skipDuplicate ? 'ueberspringen' : 'erstellen',
        duplicateOfId: duplicate?.materialId ?? null,
      }
    }
  } catch (error) {
    for (const path of stagingPaths) await deleteFile(path)
    throw error
  }

  const detected: BulkUploadDetected = {
    files: detectedFiles,
    aiEnabled: settings.enabled,
    aiErrors,
  }

  const totalBytes = pdfFiles.reduce((sum, f) => sum + f.buffer.length, 0)
  const firstName = pdfFiles[0]!.fileName
  const sourceFileName =
    pdfFiles.length === 1 ? firstName : `${pdfFiles.length} PDFs (u. a. ${firstName})`

  const db = useDatabase()
  const [run] = await db
    .insert(importRuns)
    .values({
      userId,
      sourceFileName,
      sourceSizeBytes: totalBytes,
      sourceChecksum: sha256(Buffer.from(checksums.join('|'))),
      adapterId: BULK_PDF_ADAPTER_ID,
      adapterVersion: BULK_PDF_ADAPTER_VERSION,
      status: 'vorschau',
      detected: detected as never,
      mapping: mapping as never,
      stagingPath: detectedFiles[0]?.stagingPath ?? null,
    })
    .returning({ id: importRuns.id })

  const runId = run!.id
  await addLog(
    runId,
    'info',
    `${pdfFiles.length} PDF${pdfFiles.length === 1 ? '' : 's'} analysiert (${formatBytes(totalBytes)}).`,
  )
  if (settings.enabled) {
    await addLog(
      runId,
      aiErrors ? 'warnung' : 'info',
      aiErrors
        ? `KI-Vorschläge teilweise fehlgeschlagen (${aiErrors}). Fehlende Vorschläge nutzen den Dateinamen.`
        : 'Metadaten-Vorschläge per KI erzeugt.',
    )
  } else {
    await addLog(runId, 'info', 'KI deaktiviert – Titel aus Dateinamen abgeleitet.')
  }

  log.info('Stapel-Upload analysiert', { runId, files: pdfFiles.length, aiEnabled: settings.enabled })
  return { runId, fileCount: pdfFiles.length, aiEnabled: settings.enabled }
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
    gradeLevel: normalizeGradeLevel(mapping.gradeLevel ?? previous.gradeLevel) ?? null,
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

  const db = useDatabase()
  await db.update(importRuns).set({ status: 'laeuft' }).where(eq(importRuns.id, runId))

  let subjectId: string | null = mapping.subjectId ?? null
  if (!subjectId && mapping.subjectName?.trim()) {
    subjectId = await getOrCreateSubject(mapping.subjectName.trim())
  }

  const gradeLevel = normalizeGradeLevel(mapping.gradeLevel)
  const stats: BulkUploadStats = {
    materialien: 0,
    dateien: 0,
    uebersprungen: 0,
    fehlgeschlagen: 0,
  }
  const errors: { sourceRef: string; message: string }[] = []
  const materialIds: string[] = []
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

  for (const file of files) {
    const decision = mapping.records?.[file.sourceRef]
    // `include` ist die verbindliche Nutzerentscheidung (auch bei Dubletten).
    if (decision?.include === false) {
      stats.uebersprungen = (stats.uebersprungen ?? 0) + 1
      await track(
        file.sourceRef,
        decision.duplicateOfId ?? file.duplicate?.materialId ?? null,
        'uebersprungen',
        file.duplicate ? 'Als Dublette übersprungen' : 'Vom Nutzer abgewählt',
        decision.duplicateOfId ?? file.duplicate?.materialId,
      )
      continue
    }

    const title = (decision?.title ?? file.suggestions.title).trim()
    if (!title) {
      stats.fehlgeschlagen = (stats.fehlgeschlagen ?? 0) + 1
      errors.push({ sourceRef: file.sourceRef, message: 'Titel fehlt.' })
      await track(file.sourceRef, null, 'fehlgeschlagen', 'Titel fehlt')
      await addLog(runId, 'fehler', `„${file.fileName}“: Titel fehlt.`)
      continue
    }

    try {
      const buffer = await readFile(resolveStoragePath(file.stagingPath))
      const materialType = (decision?.materialType ??
        file.suggestions.materialType ??
        mapping.defaultMaterialType ??
        'arbeitsblatt') as MaterialType
      const description =
        (decision?.description ?? file.suggestions.description)?.trim() || null
      const tagNames = decision?.tagNames ?? file.suggestions.tagNames ?? []

      const materialId = await createMaterial(
        {
          title,
          description,
          materialType,
          origin: 'manuell',
          schoolForm: mapping.schoolForm ?? null,
          subjectIds: subjectId ? [subjectId] : [],
          gradeLevels: gradeLevel ? [gradeLevel] : [],
          tagNames,
          aiMeta: file.suggestions.aiUsed
            ? {
                generatedAt: new Date().toISOString(),
                promptVersion: 'bulk-pdf-metadata-v1',
                sourceFileName: file.fileName,
              }
            : null,
        },
        userId,
      )

      const variantRows = await db.execute<{ id: string }>(
        sql`select id from material_variants
          where material_id = ${materialId}::uuid order by sort_order limit 1`,
      )
      const variantId = (variantRows as unknown as { id: string }[])[0]!.id

      await addFileAsset(
        variantId,
        { buffer, fileName: file.fileName },
        { role: 'haupt' },
      )

      materialIds.push(materialId)
      stats.materialien = (stats.materialien ?? 0) + 1
      stats.dateien = (stats.dateien ?? 0) + 1
      await track(file.sourceRef, materialId, 'erstellt')
      await deleteFile(file.stagingPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      stats.fehlgeschlagen = (stats.fehlgeschlagen ?? 0) + 1
      errors.push({ sourceRef: file.sourceRef, message })
      await track(file.sourceRef, null, 'fehlgeschlagen', message)
      await addLog(runId, 'fehler', `„${file.fileName}“: ${message}`)
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
    `Stapel abgeschlossen: ${stats.materialien} Materialien, ${stats.uebersprungen} übersprungen, ${stats.fehlgeschlagen} fehlgeschlagen.`,
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

  for (const item of items) {
    if (item.action !== 'erstellt' || !item.entityId || item.entityType !== 'material') continue
    try {
      await deleteMaterial(item.entityId)
      removed.materialien = (removed.materialien ?? 0) + 1
    } catch (error) {
      await addLog(
        runId,
        'warnung',
        `Material ${item.entityId} konnte nicht entfernt werden: ${
          error instanceof Error ? error.message : String(error)
        }`,
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
  mapping: BulkUploadMapping | null
  stats: BulkUploadStats | null
  errorMessage: string | null
  aiEnabled: boolean
  startedAt: string
  finishedAt: string | null
  undoneAt: string | null
  canCommit: boolean
  canUndo: boolean
}

export async function getBulkRunOverview(runId: string): Promise<BulkRunOverview> {
  const run = await requireBulkRun(runId)
  const detected = (run.detected ?? {}) as unknown as BulkUploadDetected

  return {
    runId: run.id,
    adapterLabel: BULK_PDF_ADAPTER_LABEL,
    status: run.status,
    sourceFileName: run.sourceFileName,
    sourceSizeBytes: run.sourceSizeBytes,
    files: detected.files ?? [],
    mapping: (run.mapping as unknown as BulkUploadMapping | null) ?? null,
    stats: (run.stats as unknown as BulkUploadStats | null) ?? null,
    errorMessage: run.errorMessage,
    aiEnabled: Boolean(detected.aiEnabled),
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
  }

  await useDatabase().delete(importRuns).where(eq(importRuns.id, runId))
}

/** Für die Schulportal-Importliste: Stapel-Uploads ausblenden. */
export function excludeBulkAdapterSql() {
  return ne(importRuns.adapterId, BULK_PDF_ADAPTER_ID)
}

export { BULK_PDF_ADAPTER_ID, BULK_PDF_ADAPTER_LABEL }
