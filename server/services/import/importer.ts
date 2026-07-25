import { readFile } from 'node:fs/promises'
import { isError } from 'h3'
import { oeffentlicheFehlermeldung } from '#shared/utils/public-error'
import { desc, eq, sql } from 'drizzle-orm'
import { useDatabase } from '../../database/client'
import {
  importLogs,
  importRunItems,
  importRuns,
  type ImportMapping,
  type ImportRun,
  type ImportStats,
} from '../../database/schema'
import { appError, notFound } from '../../utils/errors'
import { sha256 } from '../../utils/crypto'
import { createLogger } from '../../utils/logger'
import {
  addFileAsset,
  createMaterial,
  deleteMaterial,
} from '../material.service'
import { attachMaterial, createLesson, deleteLesson } from '../lesson.service'
import { createSeries, deleteSeries } from '../series.service'
import { deleteFile, resolveStoragePath, storeStagingFile } from '../storage.service'
import { getOrCreateLearningGroup, getOrCreateSubject, getOrCreateTopic } from '../taxonomy.service'
import { waitForIndex } from '../search/indexer'
import { findAttachmentDuplicates, findLessonDuplicates } from './duplicates'
import { detectAdapters, detectBestAdapter, getAdapter } from './registry'
import type { ImportSource, ParsedExport } from './types'

const log = createLogger('import')

export interface AnalyzedAttachment {
  path: string
  fileName: string
  sizeBytes: number
  checksum: string
  duplicate: { materialId: string; title: string; reason: string } | null
}

export interface AnalyzedLesson {
  sourceRef: string
  date: string | null
  periodFrom: number | null
  periodTo: number | null
  periods: number | null
  topic: string
  content: string | null
  homework: string | null
  substituteTeacher: string | null
  warnings: string[]
  attachments: AnalyzedAttachment[]
  duplicate: {
    lessonId: string
    title: string
    date: string | null
    reason: string
    confidence: 'sicher' | 'moeglich'
  } | null
}

export interface ImportAnalysis {
  runId: string
  adapterId: string
  adapterLabel: string
  adapterVersion: string
  confidence: number
  detectionReason: string
  alternatives: { id: string; label: string; confidence: number; reason: string }[]
  course: ParsedExport['course']
  exportedAt: string | null
  exportedBy: string | null
  warnings: string[]
  lessons: AnalyzedLesson[]
  orphanFiles: AnalyzedAttachment[]
  suggestedMapping: ImportMapping
  summary: {
    lessons: number
    attachments: number
    duplicateLessons: number
    duplicateAttachments: number
    totalBytes: number
  }
}

/**
 * Schritt 1–3: Datei entgegennehmen, Format erkennen, Vorschau erzeugen.
 * Die Datei wird zwischengespeichert, damit der eigentliche Import später
 * ohne erneuten Upload laufen kann.
 */
export async function analyzeImport(
  file: { buffer: Buffer; fileName: string },
  userId: string | null,
  options: { adapterId?: string } = {},
): Promise<ImportAnalysis> {
  const db = useDatabase()
  const source: ImportSource = {
    fileName: file.fileName,
    buffer: file.buffer,
    sizeBytes: file.buffer.length,
  }

  const allMatches = await detectAdapters(source)
  const match = options.adapterId
    ? {
        adapter: getAdapter(options.adapterId),
        confidence:
          allMatches.find((m) => m.adapter.id === options.adapterId)?.confidence ?? 0,
        reason: 'Manuell ausgewählt.',
      }
    : await detectBestAdapter(source)

  let parsed: ParsedExport
  try {
    parsed = await match.adapter.parse(source)
  } catch (error) {
    if (isError(error) && error.statusCode) throw error
    throw appError(
      'IMPORT_FEHLER',
      oeffentlicheFehlermeldung(
        error,
        'Die Datei konnte nicht ausgewertet werden. Bitte prüfen, ob es sich um eine gültige Kursmappe aus dem SchulPortal handelt.',
      ),
      { cause: error },
    )
  }

  const stagingPath = await storeStagingFile(file.buffer, file.fileName)

  // Prüfsummen aller Anlagen berechnen, um Dubletten schon in der Vorschau zu zeigen.
  const checksums = new Map<string, string>()
  for (const attachment of [
    ...parsed.lessons.flatMap((l) => l.attachments),
    ...parsed.orphanFiles,
  ]) {
    const content = await match.adapter.readAttachment(source, attachment.path)
    if (content) checksums.set(attachment.path, sha256(content))
  }

  const attachmentDuplicates = await findAttachmentDuplicates([...checksums.values()], db)

  // Für die Dublettenprüfung der Stunden die vermutete Lerngruppe heranziehen.
  const existingGroupId = await findExistingLearningGroupId(
    parsed.course.groupName,
    parsed.course.schoolYear,
  )
  const lessonDuplicates = await findLessonDuplicates(
    parsed.lessons.map((l) => ({ sourceRef: l.sourceRef, date: l.date, title: l.topic })),
    existingGroupId,
    db,
  )

  const toAnalyzed = (attachment: {
    path: string
    fileName: string
    sizeBytes: number
  }): AnalyzedAttachment => {
    const checksum = checksums.get(attachment.path) ?? ''
    const duplicate = attachmentDuplicates.get(checksum)
    return {
      ...attachment,
      checksum,
      duplicate: duplicate
        ? { materialId: duplicate.materialId, title: duplicate.title, reason: duplicate.reason }
        : null,
    }
  }

  const analyzedLessons: AnalyzedLesson[] = parsed.lessons.map((lesson) => {
    const duplicate = lessonDuplicates.get(lesson.sourceRef)
    return {
      sourceRef: lesson.sourceRef,
      date: lesson.date,
      periodFrom: lesson.periodFrom,
      periodTo: lesson.periodTo,
      periods: lesson.periods,
      topic: lesson.topic,
      content: lesson.content,
      homework: lesson.homework,
      substituteTeacher: lesson.substituteTeacher,
      warnings: lesson.warnings,
      attachments: lesson.attachments.map(toAnalyzed),
      duplicate: duplicate
        ? {
            lessonId: duplicate.lessonId,
            title: duplicate.title,
            date: duplicate.date,
            reason: duplicate.reason,
            confidence: duplicate.confidence,
          }
        : null,
    }
  })

  const orphanFiles = parsed.orphanFiles.map(toAnalyzed)

  const suggestedMapping: ImportMapping = {
    seriesMode: 'neu',
    seriesTitle: buildSeriesTitle(parsed),
    subjectName: parsed.course.subjectName ?? undefined,
    learningGroupName: parsed.course.groupName ?? undefined,
    gradeLevel: parsed.course.gradeLevel,
    schoolYear: parsed.course.schoolYear ?? undefined,
    createMaterials: true,
    linkDuplicates: true,
    defaultLessonStatus: 'durchgefuehrt',
    records: Object.fromEntries(
      analyzedLessons.map((lesson) => [
        lesson.sourceRef,
        {
          // Sichere Dubletten werden standardmäßig nicht erneut angelegt.
          include: lesson.duplicate?.confidence !== 'sicher',
          title: lesson.topic,
          duplicateOfId: lesson.duplicate?.lessonId ?? null,
          action: (lesson.duplicate?.confidence === 'sicher'
            ? 'ueberspringen'
            : 'erstellen') as 'erstellen' | 'ueberspringen',
        },
      ]),
    ),
  }

  const [run] = await db
    .insert(importRuns)
    .values({
      userId,
      sourceFileName: file.fileName,
      sourceSizeBytes: file.buffer.length,
      sourceChecksum: sha256(file.buffer),
      adapterId: match.adapter.id,
      adapterVersion: match.adapter.version,
      status: 'vorschau',
      detected: { course: parsed.course, lessons: analyzedLessons, orphanFiles } as never,
      mapping: suggestedMapping,
      stagingPath,
    })
    .returning({ id: importRuns.id })

  const runId = run!.id
  await addLog(runId, 'info', `Datei „${file.fileName}“ als ${match.adapter.label} erkannt.`)
  for (const warning of parsed.warnings) await addLog(runId, 'warnung', warning)

  return {
    runId,
    adapterId: match.adapter.id,
    adapterLabel: match.adapter.label,
    adapterVersion: match.adapter.version,
    confidence: match.confidence,
    detectionReason: match.reason,
    alternatives: allMatches
      .filter((m) => m.adapter.id !== match.adapter.id)
      .map((m) => ({
        id: m.adapter.id,
        label: m.adapter.label,
        confidence: m.confidence,
        reason: m.reason,
      })),
    course: parsed.course,
    exportedAt: parsed.exportedAt,
    exportedBy: parsed.exportedBy,
    warnings: parsed.warnings,
    lessons: analyzedLessons,
    orphanFiles,
    suggestedMapping,
    summary: {
      lessons: analyzedLessons.length,
      attachments: analyzedLessons.reduce((sum, l) => sum + l.attachments.length, 0) + orphanFiles.length,
      duplicateLessons: analyzedLessons.filter((l) => l.duplicate).length,
      duplicateAttachments: [...analyzedLessons.flatMap((l) => l.attachments), ...orphanFiles].filter(
        (a) => a.duplicate,
      ).length,
      totalBytes: file.buffer.length,
    },
  }
}

function buildSeriesTitle(parsed: ParsedExport): string {
  const parts = [parsed.course.rawName]
  if (parsed.course.schoolYear) parts.push(parsed.course.schoolYear)
  if (parsed.course.halfYear) parts.push(`${parsed.course.halfYear}. Halbjahr`)
  return parts.join(' · ')
}

import { normalizeGradeLevel } from '#shared/utils/jahrgangsstufen'

async function findExistingLearningGroupId(
  name: string | null,
  schoolYear: string | null,
): Promise<string | null> {
  if (!name) return null
  const rows = await useDatabase().execute<{ id: string }>(
    sql`select id from learning_groups
      where lower(name) = lower(${name})
      and (${schoolYear}::text is null or school_year = ${schoolYear})
      limit 1`,
  )
  return (rows as unknown as { id: string }[])[0]?.id ?? null
}

export async function updateMapping(runId: string, mapping: ImportMapping): Promise<void> {
  const db = useDatabase()
  const [updated] = await db
    .update(importRuns)
    .set({ mapping })
    .where(eq(importRuns.id, runId))
    .returning({ id: importRuns.id })
  if (!updated) throw notFound('Der Importvorgang')
}

export interface CommitResult {
  runId: string
  status: 'importiert' | 'teilweise_importiert' | 'fehlgeschlagen'
  stats: ImportStats
  errors: { sourceRef: string; message: string }[]
}

/**
 * Schritt 4–9: Daten übernehmen.
 * Jeder Quelldatensatz wird einzeln verarbeitet; ein Fehler beendet den Import
 * nicht, sondern wird protokolliert und in der Zusammenfassung ausgewiesen.
 */
export async function commitImport(
  runId: string,
  userId: string | null,
  mappingOverride?: ImportMapping,
): Promise<CommitResult> {
  const db = useDatabase()
  const [run] = await db.select().from(importRuns).where(eq(importRuns.id, runId)).limit(1)
  if (!run) throw notFound('Der Importvorgang')

  if (run.status === 'importiert' || run.status === 'teilweise_importiert') {
    throw appError('KONFLIKT', 'Dieser Importvorgang wurde bereits abgeschlossen.')
  }
  if (!run.stagingPath) {
    throw appError('IMPORT_FEHLER', 'Die hochgeladene Datei ist nicht mehr verfügbar. Bitte erneut hochladen.')
  }

  // Override ergänzt die gespeicherte Zuordnung; so gehen Felder wie Schulform
  // und Jahrgang nicht verloren, wenn der Client nur Teilwerte mitschickt.
  const mapping: ImportMapping = {
    ...(run.mapping ?? {}),
    ...(mappingOverride ?? {}),
  }
  if (mappingOverride) await updateMapping(runId, mapping)

  await db.update(importRuns).set({ status: 'laeuft' }).where(eq(importRuns.id, runId))

  const adapter = getAdapter(run.adapterId)
  const buffer = await readFile(resolveStoragePath(run.stagingPath))
  const source: ImportSource = {
    fileName: run.sourceFileName,
    buffer,
    sizeBytes: buffer.length,
  }
  const parsed = await adapter.parse(source)

  const stats: ImportStats = {
    reihen: 0,
    stunden: 0,
    materialien: 0,
    dateien: 0,
    uebersprungen: 0,
    fehlgeschlagen: 0,
  }
  const errors: { sourceRef: string; message: string }[] = []
  let sequence = 0

  const track = async (
    sourceRef: string,
    entityType: string,
    entityId: string | null,
    action: 'erstellt' | 'verknuepft' | 'uebersprungen' | 'fehlgeschlagen',
    message?: string,
    duplicateOfId?: string | null,
  ) => {
    await db.insert(importRunItems).values({
      runId,
      sourceRef,
      entityType,
      entityId,
      action,
      duplicateOfId: duplicateOfId ?? null,
      message: message ?? null,
      sequence: sequence++,
    })
  }

  // --- Fach und Lerngruppe -------------------------------------------------
  let subjectId: string | null = mapping.subjectId ?? null
  if (!subjectId && mapping.subjectName) {
    subjectId = await getOrCreateSubject(mapping.subjectName)
    await track('kurs:fach', 'subject', subjectId, 'erstellt', `Fach „${mapping.subjectName}“`)
  }

  const mappedGradeLevel = normalizeGradeLevel(mapping.gradeLevel)

  let learningGroupId: string | null = mapping.learningGroupId ?? null
  if (!learningGroupId && mapping.learningGroupName) {
    learningGroupId = await getOrCreateLearningGroup({
      name: mapping.learningGroupName,
      subjectId,
      gradeLevel: mappedGradeLevel,
      schoolYear: mapping.schoolYear ?? null,
      schoolForm: mapping.schoolForm ?? null,
    })
    await track('kurs:lerngruppe', 'learning_group', learningGroupId, 'erstellt')
  }

  // --- Reihe ---------------------------------------------------------------
  let seriesId: string | null = null
  if (mapping.seriesMode === 'bestehend' && mapping.seriesId) {
    seriesId = mapping.seriesId
    await track('kurs:reihe', 'series', seriesId, 'verknuepft', 'Bestehende Reihe verwendet')
  } else if (mapping.seriesMode !== 'keine') {
    const dates = parsed.lessons.map((l) => l.date).filter((d): d is string => !!d).sort()
    seriesId = await createSeries(
      {
        title: mapping.seriesTitle || buildSeriesTitle(parsed),
        description: `Aus dem Schulportal Hessen importiert (Kursmappe „${parsed.course.rawName}“).`,
        subjectId,
        learningGroupId,
        schoolYear: mapping.schoolYear ?? parsed.course.schoolYear,
        startDate: dates[0] ?? null,
        endDate: dates.at(-1) ?? null,
        status: 'abgeschlossen',
        origin: 'import',
      },
      userId,
    )
    stats.reihen = 1
    await track('kurs:reihe', 'series', seriesId, 'erstellt')
  }

  // --- Stunden und Anlagen -------------------------------------------------
  /** Prüfsumme → Material-ID, damit dieselbe Datei nur einmal angelegt wird. */
  const materialByChecksum = new Map<string, string>()
  let position = 0

  for (const lesson of parsed.lessons) {
    const decision = mapping.records?.[lesson.sourceRef]
    if (decision && decision.include === false) {
      stats.uebersprungen = (stats.uebersprungen ?? 0) + 1
      await track(lesson.sourceRef, 'lesson', null, 'uebersprungen', 'Vom Nutzer abgewählt')
      continue
    }
    if (decision?.action === 'ueberspringen') {
      stats.uebersprungen = (stats.uebersprungen ?? 0) + 1
      await track(
        lesson.sourceRef,
        'lesson',
        decision.duplicateOfId ?? null,
        'uebersprungen',
        'Als Dublette erkannt',
        decision.duplicateOfId,
      )
      continue
    }

    try {
      const topicId = subjectId ? await getOrCreateTopic(lesson.topic, { subjectId }) : null

      const lessonId = await createLesson(
        {
          title: decision?.title?.trim() || lesson.topic,
          date: lesson.date,
          periodFrom: lesson.periodFrom,
          periodTo: lesson.periodTo,
          // Eine Schulstunde wird mit 45 Minuten angesetzt.
          durationMinutes: lesson.periods ? lesson.periods * 45 : null,
          subjectId,
          learningGroupId,
          topicId,
          seriesId,
          positionInSeries: seriesId ? position++ : null,
          methodSummary: lesson.content,
          homework: lesson.homework,
          substituteTeacher: lesson.substituteTeacher,
          status: (mapping.defaultLessonStatus as never) ?? 'durchgefuehrt',
          origin: 'import',
        },
        userId,
      )

      stats.stunden = (stats.stunden ?? 0) + 1
      await track(lesson.sourceRef, 'lesson', lessonId, 'erstellt')

      if (mapping.createMaterials === false) continue

      for (const attachment of lesson.attachments) {
        try {
          const content = await adapter.readAttachment(source, attachment.path)
          if (!content) {
            await addLog(runId, 'warnung', `Anlage „${attachment.path}“ fehlt im Archiv.`)
            continue
          }

          const checksum = sha256(content)
          let materialId = materialByChecksum.get(checksum) ?? null

          if (!materialId && mapping.linkDuplicates !== false) {
            const existing = await findAttachmentDuplicates([checksum], db)
            const duplicate = existing.get(checksum)
            if (duplicate) {
              materialId = duplicate.materialId
              await track(
                `${lesson.sourceRef}:${attachment.path}`,
                'material',
                materialId,
                'verknuepft',
                'Datei bereits vorhanden – vorhandenes Material verknüpft',
                duplicate.materialId,
              )
            }
          }

          if (!materialId) {
            materialId = await createMaterial(
              {
                title: titleFromFileName(attachment.fileName),
                description: `Aus dem Schulportal importiert (Termin ${lesson.date ?? 'ohne Datum'}).`,
                materialType: guessMaterialType(attachment.fileName),
                origin: 'import',
                schoolForm: mapping.schoolForm ?? null,
                subjectIds: subjectId ? [subjectId] : [],
                topicIds: topicId ? [topicId] : [],
                learningGroupIds: learningGroupId ? [learningGroupId] : [],
                gradeLevels: mappedGradeLevel ? [mappedGradeLevel] : [],
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
              { buffer: content, fileName: attachment.fileName },
              { role: 'haupt' },
            )

            materialByChecksum.set(checksum, materialId)
            stats.materialien = (stats.materialien ?? 0) + 1
            stats.dateien = (stats.dateien ?? 0) + 1
            await track(`${lesson.sourceRef}:${attachment.path}`, 'material', materialId, 'erstellt')
          }

          await attachMaterial(lessonId, { materialId, usage: 'unterricht' })
        } catch (error) {
          // Eine fehlerhafte Anlage darf weder die Stunde noch den Import stoppen.
          const message = oeffentlicheFehlermeldung(
            error,
            'Die Anlage konnte nicht übernommen werden.',
          )
          stats.fehlgeschlagen = (stats.fehlgeschlagen ?? 0) + 1
          errors.push({ sourceRef: attachment.path, message })
          await track(`${lesson.sourceRef}:${attachment.path}`, 'material', null, 'fehlgeschlagen', message)
          await addLog(runId, 'fehler', `Anlage „${attachment.fileName}“: ${message}`)
        }
      }
    } catch (error) {
      const message = oeffentlicheFehlermeldung(error, 'Der Termin konnte nicht importiert werden.')
      stats.fehlgeschlagen = (stats.fehlgeschlagen ?? 0) + 1
      errors.push({ sourceRef: lesson.sourceRef, message })
      await track(lesson.sourceRef, 'lesson', null, 'fehlgeschlagen', message)
      await addLog(runId, 'fehler', `Termin ${lesson.date ?? lesson.sourceRef}: ${message}`)
    }
  }

  const status: CommitResult['status'] =
    (stats.fehlgeschlagen ?? 0) === 0
      ? 'importiert'
      : (stats.stunden ?? 0) > 0
        ? 'teilweise_importiert'
        : 'fehlgeschlagen'

  await db
    .update(importRuns)
    .set({ status, stats, finishedAt: new Date() })
    .where(eq(importRuns.id, runId))

  await addLog(
    runId,
    status === 'importiert' ? 'info' : 'warnung',
    `Import abgeschlossen: ${stats.stunden} Stunden, ${stats.materialien} Materialien, ${stats.uebersprungen} übersprungen, ${stats.fehlgeschlagen} fehlgeschlagen.`,
  )

  await waitForIndex()
  log.info('Import abgeschlossen', { runId, status, stats })

  return { runId, status, stats, errors }
}

/**
 * Schritt 10: Import rückgängig machen.
 * Es werden ausschließlich Datensätze entfernt, die dieser Lauf angelegt hat –
 * verknüpfte Bestandsdaten bleiben unangetastet.
 */
export async function undoImport(runId: string): Promise<{ removed: ImportStats }> {
  const db = useDatabase()
  const [run] = await db.select().from(importRuns).where(eq(importRuns.id, runId)).limit(1)
  if (!run) throw notFound('Der Importvorgang')
  if (run.undoneAt) throw appError('KONFLIKT', 'Dieser Import wurde bereits rückgängig gemacht.')
  if (!['importiert', 'teilweise_importiert'].includes(run.status)) {
    throw appError('KONFLIKT', 'Nur abgeschlossene Importvorgänge können rückgängig gemacht werden.')
  }

  const items = await db
    .select()
    .from(importRunItems)
    .where(eq(importRunItems.runId, runId))
    .orderBy(desc(importRunItems.sequence))

  const removed: ImportStats = { reihen: 0, stunden: 0, materialien: 0 }

  // In umgekehrter Anlagereihenfolge löschen, damit Abhängigkeiten aufgehen.
  for (const item of items) {
    if (item.action !== 'erstellt' || !item.entityId) continue

    try {
      switch (item.entityType) {
        case 'lesson':
          await deleteLesson(item.entityId)
          removed.stunden = (removed.stunden ?? 0) + 1
          break
        case 'material':
          await deleteMaterial(item.entityId)
          removed.materialien = (removed.materialien ?? 0) + 1
          break
        case 'series':
          await deleteSeries(item.entityId)
          removed.reihen = (removed.reihen ?? 0) + 1
          break
        default:
          // Fächer, Lerngruppen und Themen bleiben erhalten: sie werden
          // typischerweise auch von anderen Datensätzen verwendet.
          break
      }
    } catch (error) {
      // Bereits gelöschte oder inzwischen anderweitig verwendete Datensätze
      // sollen das Rückgängigmachen nicht verhindern.
      await addLog(
        runId,
        'warnung',
        `${item.entityType} ${item.entityId} konnte nicht entfernt werden: ${oeffentlicheFehlermeldung(
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
    `Import rückgängig gemacht: ${removed.stunden} Stunden, ${removed.materialien} Materialien, ${removed.reihen} Reihen entfernt.`,
  )

  if (run.stagingPath) await deleteFile(run.stagingPath)
  await db.update(importRuns).set({ stagingPath: null }).where(eq(importRuns.id, runId))

  return { removed }
}

export interface RunOverview {
  runId: string
  adapterId: string
  adapterLabel: string
  adapterVersion: string
  status: ImportRun['status']
  sourceFileName: string
  sourceSizeBytes: number | null
  course: ParsedExport['course'] | null
  lessons: AnalyzedLesson[]
  orphanFiles: AnalyzedAttachment[]
  mapping: ImportMapping | null
  stats: ImportStats
  errorMessage: string | null
  startedAt: string
  finishedAt: string | null
  undoneAt: string | null
  canCommit: boolean
  canUndo: boolean
}

/**
 * Stellt einen laufenden oder abgeschlossenen Vorgang wieder her, damit der
 * Assistent nach einem Seitenwechsel dort weitermacht, wo er unterbrochen
 * wurde – die Vorschau kommt aus `detected`, nicht aus einem erneuten Upload.
 */
export async function getRunOverview(runId: string): Promise<RunOverview> {
  const [run] = await useDatabase()
    .select()
    .from(importRuns)
    .where(eq(importRuns.id, runId))
    .limit(1)
  if (!run) throw notFound('Der Importvorgang')

  if (run.adapterId === 'bulk-pdf-materials') {
    throw appError(
      'UNGUELTIGE_EINGABE',
      'Dieser Vorgang ist ein PDF-Stapel-Upload. Bitte unter Materialien → Stapel-Upload öffnen.',
    )
  }

  const detected = (run.detected ?? {}) as {
    course?: ParsedExport['course']
    lessons?: AnalyzedLesson[]
    orphanFiles?: AnalyzedAttachment[]
  }

  let adapterLabel = run.adapterId
  try {
    adapterLabel = getAdapter(run.adapterId).label
  } catch {
    // Ein Adapter kann nach einem Update entfallen sein; das Protokoll bleibt lesbar.
  }

  return {
    runId: run.id,
    adapterId: run.adapterId,
    adapterLabel,
    adapterVersion: run.adapterVersion,
    status: run.status,
    sourceFileName: run.sourceFileName,
    sourceSizeBytes: run.sourceSizeBytes,
    course: detected.course ?? null,
    lessons: detected.lessons ?? [],
    orphanFiles: detected.orphanFiles ?? [],
    mapping: run.mapping,
    stats: run.stats,
    errorMessage: run.errorMessage,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    undoneAt: run.undoneAt?.toISOString() ?? null,
    canCommit: run.status === 'vorschau' || run.status === 'analysiert',
    canUndo:
      !run.undoneAt && ['importiert', 'teilweise_importiert'].includes(run.status),
  }
}

export async function discardImport(runId: string): Promise<void> {
  const db = useDatabase()
  const [run] = await db.select().from(importRuns).where(eq(importRuns.id, runId)).limit(1)
  if (!run) throw notFound('Der Importvorgang')

  if (run.stagingPath) await deleteFile(run.stagingPath)
  await db.delete(importRuns).where(eq(importRuns.id, runId))
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

function titleFromFileName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    // Zeitstempel aus dem Schulportal entfernen, z. B. „-2025-03-26-10-07-15“.
    .replace(/\s\d{4} \d{2} \d{2} \d{2} \d{2} \d{2}$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Grobe Einordnung anhand des Dateinamens – vom Nutzer jederzeit änderbar. */
function guessMaterialType(fileName: string): string {
  const name = fileName.toLowerCase()
  if (/(l(ö|oe)sung|-lsg|_lsg)/.test(name)) return 'musterloesung'
  if (/(klausur|klassenarbeit)/.test(name)) return 'klausur'
  if (/(lernkontrolle|test|quiz)/.test(name)) return 'lernkontrolle'
  if (/(steckbrief|vorlage|^ab[-_ ]|arbeitsblatt)/.test(name)) return 'arbeitsblatt'
  if (/\.(png|jpe?g|gif|webp|avif)$/.test(name)) return 'bild'
  if (/\.(mp4|webm|mov)$/.test(name)) return 'video'
  if (/\.(pptx?|odp)$/.test(name)) return 'praesentation'
  if (/(elternbrief|brief|einverst(ä|ae)ndnis)/.test(name)) return 'sonstiges'
  return 'arbeitsblatt'
}
