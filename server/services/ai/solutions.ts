import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { useDatabase } from '../../database/client'
import { aiJobs, aiSolutionRuns, materialAssets, materialVariants } from '../../database/schema'
import { oeffentlicheFehlermeldung } from '#shared/utils/public-error'
import { appError } from '../../utils/errors'
import { createLogger } from '../../utils/logger'
import { getMaterialDetail } from '../../repositories/material.repository'
import {
  addFileAsset,
  addRelation,
  createMaterial,
  deleteAsset,
  updateMaterial,
} from '../material.service'
import { extensionOf, resolveStoragePath } from '../storage.service'
import { convertOfficeFileToPdf } from '../office-convert.service'
import {
  getAiSettings,
  getPrivacySettings,
  type AiSettings,
} from '../settings.service'
import { PDFDocument } from 'pdf-lib'
import {
  buildAnswerListPdf,
  buildSolutionDocx,
  detectDocxBlanks,
  detectPdfBlankRegions,
  enrichSolutionPlacements,
  fillPdfAcroForm,
  overlayPdfAnswers,
  solutionFileName,
  solutionToMarkdown,
  summarizeBlanksForLog,
  type FilledDocument,
  type PdfBlankRegion,
  type SolutionFillMode,
  type StructuredSolution,
  type TextBlankInfo,
} from './document-fill'
import { kiAutorAnzeige } from '#shared/utils/ki'
import {
  AI_CONTENT_NOTICE,
  AI_CONTENT_NOTICE_MD,
} from './prompts'
import { rasterizePdf } from './rasterize'
import { ensureExtractedText } from './document-text'
import { analyzeDocxTargets } from './solutions/docx-analyzer'
import { logPipeline } from './solutions/logging'
import { buildSolutionPlan } from './solutions/orchestrator'
import { detectPdfLayoutTargets } from './solutions/pdf-answer-lines'
import { fusePdfClozeTargets } from './solutions/pdf-cloze-target-fusion'
import { repairCandidateBankViaVision } from './solutions/repair/candidate-bank-vision'
import { repairDocxTargetsViaVision } from './solutions/repair/docx-targets-vision'
import {
  assessPdfLayoutPlan,
  repairPdfLayoutViaVision,
} from './solutions/repair/pdf-layout-vision'
import {
  verifyPdfSolutionViaVision,
  type PdfSolutionQualityResult,
} from './solutions/repair/pdf-solution-vision'
import { mergeNativeAndVisualTargets } from './solutions/docx-target-merger'
import { renderPdfSolution } from './solutions/renderers/pdf-renderer'
import { renderDocxSolution } from './solutions/renderers/docx-renderer'
import type { TaskBlock } from './solutions/types'
import { wakeSolutionWorker } from './solutions-v2/worker'
import { buildPdfLayoutDocumentV2, buildTextOnlyLayoutDocumentV2 } from './solutions-v2/layout-document'
import { buildSolutionPlanV2 } from './solutions-v2/plan-builder'
import { reconcileTasksWithPageLayoutV2 } from './solutions-v2/page-task-reconciler'
import { runSolutionPipelineV2, type PageVisionPart } from './solutions-v2/pipeline'
import { V2_PROMPT_VERSIONS } from './solutions-v2/prompts'
import {
  completeSolutionRun,
  saveSolutionDraft,
  SolutionReviewRequiredError,
  updateSolutionRunStage,
} from './solutions-v2/run-service'
import { SOLUTION_PIPELINE_VERSION, type PipelineV2Result } from './solutions-v2/types'

const log = createLogger('ai:solutions')

/** Obergrenze für an das Modell übergebene Dateien – schützt vor sehr großen Anhängen. */
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024

const OFFICE_EXTENSIONS = new Set(['docx', 'odt', 'doc', 'rtf'])
const PDF_EXTENSIONS = new Set(['pdf'])

export interface GenerateSolutionOptions {
  /** Nur diese Variante berücksichtigen; sonst die Standardfassung. */
  variantId?: string | null
  userInstructions?: string | null
  /** Bilder/PDFs mitschicken, sofern der Anbieter das kann. */
  useVision?: boolean
  model?: string
  /** Interne Job-ID für asynchron gestartete Läufe. Nicht aus der API befüllbar. */
  jobId?: string
}

export interface GenerateSolutionResult {
  jobId: string
  solutionMaterialId: string
  model: string
  attachments: number
  usedVision: boolean
  fillStrategy: string
  hermesUsed: boolean
  fileName: string | null
}

export interface QueuedSolutionJob {
  jobId: string
  status: 'wartend'
}

/**
 * Stellt die Erzeugung in die dauerhafte Datenbank-Warteschlange. Der Worker
 * kann den Lauf nach einem Prozessneustart erneut claimen.
 */
export async function enqueueSolutionGeneration(
  materialId: string,
  userId: string | null,
  options: GenerateSolutionOptions = {},
): Promise<QueuedSolutionJob> {
  const db = useDatabase()
  const settings = await getAiSettings()
  const provisionalModel =
    options.model?.trim() || settings.visionModel?.trim() || settings.chatModel?.trim() || 'pending'
  const jobId = await db.transaction(async (tx) => {
    const [job] = await tx
      .insert(aiJobs)
      .values({
        userId,
        materialId,
        kind: 'musterloesung',
        provider: settings.provider,
        model: provisionalModel,
        status: 'wartend',
      })
      .returning({ id: aiJobs.id })
    const id = job!.id
    await tx.insert(aiSolutionRuns).values({
      jobId: id,
      pipelineVersion: '2',
      stage: 'queued',
      progress: 0,
      options: {
        variantId: options.variantId ?? null,
        userInstructions: options.userInstructions ?? null,
        useVision: options.useVision ?? true,
        model: options.model ?? null,
      },
    })
    return id
  })
  wakeSolutionWorker()

  return { jobId, status: 'wartend' }
}

export interface SourceAsset {
  id: string
  fileName: string
  mimeType: string
  storageKey: string
  sizeBytes: number | null
  buffer: Buffer
  extension: string
}

/**
 * Erzeugt eine dokumentbasierte Musterlösung: Kopie des Originals mit
 * ausgefüllten Lücken/Feldern bzw. visuellem Text-Overlay auf PDF-Seiten.
 */
export async function generateSolution(
  materialId: string,
  userId: string | null,
  options: GenerateSolutionOptions = {},
): Promise<GenerateSolutionResult> {
  const db = useDatabase()
  const settings = await getAiSettings()

  if (!settings.enabled) {
    throw appError(
      'KI_NICHT_KONFIGURIERT',
      'Die KI-Unterstützung ist nicht aktiviert. Bitte in den Einstellungen einrichten.',
    )
  }

  const material = await getMaterialDetail(materialId, db)
  if (!material) throw appError('NICHT_GEFUNDEN', 'Das Material wurde nicht gefunden.')

  const variant =
    material.variants.find((v) => v.id === options.variantId) ??
    material.variants.find((v) => v.isDefault) ??
    material.variants[0]

  const source = variant ? await loadPrimarySourceAsset(variant.id) : null
  if (options.jobId) await updateSolutionRunStage(options.jobId, 'normalizing', 5)

  // PDF-Arbeitsblätter brauchen Seitenbilder für Lückenpositionen (bbox).
  const useVision = options.useVision ?? true
  const model = pickSolutionModel(settings, options.model, useVision)

  const documentText = variant
    ? (
        await db
          .select({ text: materialAssets.extractedText })
          .from(materialAssets)
          .where(eq(materialAssets.variantId, variant.id))
      )
        .map((row) => row.text)
        .filter((text): text is string => !!text)
        .join('\n\n---\n\n')
        .slice(0, 60_000)
    : ''

  // Lücken vor dem Modellaufruf erkennen (PDF-Geometrie oder DOCX-Textebene).
  if (options.jobId) await updateSolutionRunStage(options.jobId, 'detecting', 10)
  let detectedBlanks: PdfBlankRegion[] = []
  let docxBlanks: TextBlankInfo[] = []
  if (source && PDF_EXTENSIONS.has(source.extension)) {
    try {
      detectedBlanks = await detectPdfBlankRegions(source.buffer)
      log.info('PDF-Lücken für Prompt erkannt', {
        count: detectedBlanks.length,
        underscores: detectedBlanks.filter((b) => b.kind === 'underscore').length,
        gaps: detectedBlanks.filter((b) => b.kind === 'gap').length,
        blanks: summarizeBlanksForLog(detectedBlanks),
      })
    } catch (error) {
      log.warn('PDF-Lückenerkennung vor Prompt fehlgeschlagen', error)
    }
  } else if (source?.extension === 'docx') {
    try {
      docxBlanks = detectDocxBlanks(source.buffer)
      log.info('DOCX-Lücken für Prompt erkannt', {
        count: docxBlanks.length,
        blanks: docxBlanks.map((b) => ({
          i: b.blankIndex,
          left: b.leftText,
          right: b.rightText,
        })),
      })
    } catch (error) {
      log.warn('DOCX-Lückenerkennung vor Prompt fehlgeschlagen', error)
    }
  }

  const textForAnalysis = documentText || material.content || ''

  let pdfExtractText = ''
  if (source && PDF_EXTENSIONS.has(source.extension) && !documentText.trim()) {
    try {
      const ensured = await ensureExtractedText(source.buffer, source.fileName, settings)
      pdfExtractText = ensured.text.trim()
      if (pdfExtractText) {
        log.info('PDF-Text für Analyse nachgeladen', {
          zeichen: pdfExtractText.length,
          method: ensured.method,
          fileName: source.fileName,
        })
      }
    } catch (error) {
      log.warn('PDF-Textextraktion für Analyse fehlgeschlagen', error)
    }
  }

  let docxNative: ReturnType<typeof analyzeDocxTargets> = {
    nativeFields: [],
    targets: [],
    shapes: [],
    fullText: '',
  }
  if (source?.extension === 'docx') {
    try {
      docxNative = analyzeDocxTargets(source.buffer)
    } catch (error) {
      log.warn('DOCX-Zielanalyse fehlgeschlagen', error)
    }
  }

  let pdfLayoutTargets: Awaited<ReturnType<typeof detectPdfLayoutTargets>> = {
    tableTargets: [],
    lineTargets: [],
    shapes: [],
    rawLineCount: 0,
    clusterCount: 0,
  }
  // Tabellen und Antwortlinien sind unabhängig von Textlücken: ein Arbeitsblatt
  // kann beides enthalten. Tabellenkanten werden dabei nicht als Schreiblinien
  // weitergereicht.
  if (source && PDF_EXTENSIONS.has(source.extension)) {
    try {
      pdfLayoutTargets = await detectPdfLayoutTargets(source.buffer)
      if (pdfLayoutTargets.clusterCount > 0) {
        log.info('PDF-Antwortlinien erkannt', {
          rawLines: pdfLayoutTargets.rawLineCount,
          clusters: pdfLayoutTargets.clusterCount,
        })
      }
      if (pdfLayoutTargets.tableTargets.length > 0) {
        // "gap"-Lücken entstehen bei mehrspaltigen Rückseiten häufig allein aus
        // der Lesereihenfolge der PDF-Textebene. Echte Unterstrich-Lücken bleiben.
        detectedBlanks = detectedBlanks.filter((blank) => blank.kind !== 'gap')
        log.info('PDF-Tabellenzellen erkannt', {
          cells: pdfLayoutTargets.tableTargets.length,
          ignoredTextGaps: true,
        })
      }
    } catch (error) {
      log.warn('PDF-Layoutziel-Erkennung fehlgeschlagen', error)
    }
  }

  // Ein gemeinsamer Indexraum verhindert Kollisionen, wenn ein PDF sowohl
  // echte Lücken als auch Tabellenzellen enthält.
  if (pdfLayoutTargets.tableTargets.length > 0 && detectedBlanks.length > 0) {
    pdfLayoutTargets = {
      ...pdfLayoutTargets,
      tableTargets: pdfLayoutTargets.tableTargets.map((target, index) =>
        target.kind === 'table_cell'
          ? { ...target, blankIndex: detectedBlanks.length + index }
          : target,
      ),
    }
  }

  const analysisDocumentText = textForAnalysis || pdfExtractText || docxNative.fullText
  const planInput = () => ({
    documentText: analysisDocumentText,
    pdfText: pdfExtractText || null,
    pdfBlanks: detectedBlanks,
    docxBlanks,
    nativeFields: docxNative.nativeFields,
    shapes: [...docxNative.shapes, ...pdfLayoutTargets.shapes],
    answerTargets: [
      ...docxNative.targets,
      ...pdfLayoutTargets.tableTargets,
      ...pdfLayoutTargets.lineTargets,
    ],
  })
  let plan = buildSolutionPlan(planInput())
  let pdfClozeTargetsFused = false

  // Manche PDFs stellen jede Lücke als grafische Linie dar, während die
  // Textanalyse nur einen Teil davon erkennt. Wenn Textlücken, Linien und
  // Wortliste geometrisch/anzahlmäßig übereinstimmen, sind sie ein einziges
  // Cloze-Inventar – keine zusätzliche Freitextaufgabe.
  if (
    source &&
    PDF_EXTENSIONS.has(source.extension) &&
    detectedBlanks.length > 0 &&
    pdfLayoutTargets.lineTargets.length > detectedBlanks.length
  ) {
    try {
      const pdf = await PDFDocument.load(source.buffer)
      const fusion = fusePdfClozeTargets({
        blanks: detectedBlanks,
        lineTargets: pdfLayoutTargets.lineTargets,
        candidateBank: plan.candidateBank,
        pageSizes: pdf.getPages().map((page) => page.getSize()),
      })
      if (fusion) {
        const previousBlankCount = detectedBlanks.length
        const remainingLineTargets = pdfLayoutTargets.lineTargets.filter(
          (target) => !fusion.consumedLineTargetIds.has(target.id),
        )
        detectedBlanks = fusion.blanks
        pdfLayoutTargets = {
          ...pdfLayoutTargets,
          lineTargets: remainingLineTargets,
          shapes: pdfLayoutTargets.shapes.filter(
            (shape) => !fusion.consumedLineTargetIds.has(shape.id),
          ),
          clusterCount: remainingLineTargets.length,
        }
        plan = buildSolutionPlan(planInput())
        pdfClozeTargetsFused = true
        log.info('PDF-Lückengeometrien zusammengeführt', {
          textBlanks: previousBlankCount,
          matchedTextBlanks: fusion.matchedBlankCount,
          canonicalBlanks: detectedBlanks.length,
          consumedLines: fusion.consumedLineTargetIds.size,
          candidateCount: plan.candidateBank?.candidates.length ?? 0,
        })
      }
    } catch (error) {
      log.warn('PDF-Lückengeometrien konnten nicht zusammengeführt werden', error)
    }
  }

  let { tasks, candidateBank, blankCount } = plan
  const { document: documentModel, numberMatching } = plan

  let pdfLayoutVisionChecked = false
  let pdfLayoutRepairedViaVision = false
  if (
    source &&
    PDF_EXTENSIONS.has(source.extension) &&
    useVision &&
    model.trim()
  ) {
    const assessment = assessPdfLayoutPlan({
      documentText: analysisDocumentText,
      tasks,
      requireVision: true,
    })
    if (assessment.shouldCheck) {
      pdfLayoutVisionChecked = true
      log.info('PDF-Layout benötigt Vision-Plausibilitätscheck', {
        reasons: assessment.reasons,
        worksheetTasks: assessment.worksheetTaskCount,
        openTasks: assessment.openTaskCount,
        inplaceTasks: assessment.inplaceTaskCount,
        answerTargets: assessment.answerTargetCount,
      })
      try {
        const visual = await repairPdfLayoutViaVision({
          buffer: source.buffer,
          fileName: source.fileName,
          settings,
          model,
          documentText: analysisDocumentText,
          tasks,
          assessment,
          nativeTargets: [
            ...pdfLayoutTargets.tableTargets,
            ...pdfLayoutTargets.lineTargets,
          ],
        })
        const visualTargetCount =
          visual?.tasks.flatMap((task) => task.targets).length ?? 0
        const localHasChoiceCells = tasks.some((task) =>
          task.targets.some((target) => target.kind === 'choice_cell'),
        )
        const visualHasChoiceCells = visual?.tasks.some((task) =>
          task.targets.some((target) => target.kind === 'choice_cell'),
        )
        const localHasAuthoritativeTargets = tasks.some((task) =>
          task.targets.some((target) => target.source !== 'vision' && Boolean(target.bbox || target.nativeRef)),
        )
        const canAdoptVisualPlan = Boolean(
          visual &&
            visual.verdict === 'repair' &&
            !localHasAuthoritativeTargets &&
            !pdfClozeTargetsFused &&
            visual.tasks.length > 0 &&
            (!localHasChoiceCells || visualHasChoiceCells) &&
            (visualTargetCount > 0 || tasks.length === 0),
        )
        if (visual && canAdoptVisualPlan) {
          tasks = visual.tasks.map((task) =>
            task.kind === 'cloze' && candidateBank
              ? {
                  ...task,
                  candidateBank,
                  candidateBankStatus: 'found' as const,
                  requiresCandidateBankRepair: false,
                }
              : task,
          )
          blankCount = tasks
            .flatMap((task) => task.targets)
            .filter((target) => target.kind === 'blank').length
          pdfLayoutRepairedViaVision = true
          log.info('PDF-Layoutplan per Vision repariert', {
            verdict: visual.verdict,
            rawTasks: visual.rawTaskCount,
            tasks: tasks.length,
            answerTargets: visualTargetCount,
          })
        } else {
          if (
            tasks.length > 0 &&
            (!visual || visual.verdict === 'repair' || visual.verdict === 'no_targets')
          ) {
            const reason = !visual
              ? 'vision layout conflict: no usable response'
              : visual.tasks.length === 0
                ? 'vision layout conflict: visual check returned no tasks'
                : 'vision layout conflict: visual plan disagrees with native plan'
            tasks = tasks.map((task) => ({
              ...task,
              confidence: Math.min(task.confidence, 0.55),
              evidence: [...task.evidence, reason],
            }))
          }
          log.info('PDF-Layoutplan nach Vision-Check unverändert', {
            verdict: visual?.verdict ?? null,
            tasks: visual?.tasks.length ?? 0,
            answerTargets: visualTargetCount,
          })
        }
      } catch (error) {
        tasks = tasks.map((task) => ({
          ...task,
          confidence: Math.min(task.confidence, 0.55),
          evidence: [...task.evidence, 'vision layout conflict: check unavailable'],
        }))
        log.warn('PDF-Layout-Vision-Check fehlgeschlagen – nativer Plan bleibt aktiv', error)
      }
    }
  }

  let candidateBankRepairedViaVision = false
  const needsBankRepair = tasks.some((t) => t.requiresCandidateBankRepair)
  if (
    needsBankRepair &&
    !numberMatching &&
    source &&
    PDF_EXTENSIONS.has(source.extension) &&
    blankCount > 0
  ) {
    const repairTask = tasks.find((t) => t.requiresCandidateBankRepair)!
    try {
      const visionBank = await repairCandidateBankViaVision({
        buffer: source.buffer,
        fileName: source.fileName,
        settings,
        blankCount,
        instruction: repairTask.instruction,
        page: repairTask.page,
      })
      if (visionBank) {
        candidateBank = visionBank
        candidateBankRepairedViaVision = true
        tasks = tasks.map((t) =>
          t.kind === 'cloze'
            ? {
                ...t,
                candidateBank: visionBank,
                candidateBankStatus: 'found' as const,
                requiresCandidateBankRepair: false,
                confidence: Math.max(t.confidence, 0.92),
                evidence: [
                  ...t.evidence.filter(
                    (e) =>
                      e !== 'no word list detected' &&
                      !e.startsWith('candidate bank malformed'),
                  ),
                  `${visionBank.candidates.length} candidate terms detected via vision`,
                ],
              }
            : t,
        )
        log.info('Wortliste per Vision-Repair extrahiert', {
          count: visionBank.candidates.length,
          words: visionBank.candidates.map((c) => c.value),
          previousStatus: repairTask.candidateBankStatus,
        })
      }
    } catch (error) {
      log.warn('Vision-Wortlisten-Repair fehlgeschlagen', error)
    }
  }

  // Vision-Fallback für unsichere geometrische DOCX-Ziele (2d).
  if (
    source?.extension === 'docx' &&
    tasks.some((t) => t.requiresVisionTargetRepair)
  ) {
    const repairTask = tasks.find((t) => t.requiresVisionTargetRepair)!
    try {
      const pdfBuffer = await convertOfficeBufferToPdf(
        source.buffer,
        source.fileName ?? 'material.docx',
      )
      if (pdfBuffer) {
        const visual = await repairDocxTargetsViaVision({
          pdfBuffer,
          settings,
          instruction: repairTask.instruction,
          existingTargets: repairTask.targets,
          page: repairTask.page,
        })
        if (visual.length > 0) {
          const merged = mergeNativeAndVisualTargets(repairTask.targets, visual)
          tasks = tasks.map((t) =>
            t.id === repairTask.id
              ? {
                  ...t,
                  targets: merged.merged,
                  confidence: Math.min(t.confidence, merged.confidence + 0.1),
                  requiresVisionTargetRepair: merged.requiresVisionRepair,
                  evidence: [
                    ...t.evidence,
                    `${visual.length} vision targets, ${merged.matchedPairs} matched`,
                  ],
                  renderConfidence: merged.confidence < 0.5 ? 'low' : 'medium',
                }
              : t,
          )
          log.info('DOCX-Ziele per Vision ergänzt', {
            visual: visual.length,
            matched: merged.matchedPairs,
            confidence: merged.confidence,
          })
        }
      }
    } catch (error) {
      log.warn('DOCX-Vision-Target-Repair fehlgeschlagen', error)
    }
  }

  log.info('Musterlösungs-Aufgabenplan erkannt', {
    blanks: blankCount,
    tasks: tasks.length,
    candidateBank: candidateBank
      ? {
          count: candidateBank.candidates.length,
          reusePolicy: candidateBank.reusePolicy,
          words: candidateBank.candidates.map((c) => c.value),
        }
      : null,
    source: source?.fileName ?? null,
  })

  const prompt = JSON.stringify({
    pipelineVersion: SOLUTION_PIPELINE_VERSION,
    sourceFileName: source?.fileName ?? null,
    taskCount: tasks.length,
    taskKinds: tasks.map((task) => task.kind),
    promptVersions: V2_PROMPT_VERSIONS,
  })

  if (!documentText && !source && !material.content?.trim()) {
    throw appError(
      'KI_FEHLER',
      'Zu diesem Material liegt weder eine Datei noch auslesbarer Text vor. Bitte eine Datei hinterlegen.',
    )
  }

  const privacy = await getPrivacySettings()
  const startedAt = Date.now()

  let jobId = options.jobId
  if (jobId) {
    await db
      .update(aiJobs)
      .set({
        provider: settings.provider,
        model,
        status: 'laeuft',
        prompt: privacy.storeAiPrompts ? prompt.slice(0, 100_000) : null,
      })
      .where(eq(aiJobs.id, jobId))
  } else {
    const [job] = await db
      .insert(aiJobs)
      .values({
        userId,
        materialId,
        kind: 'musterloesung',
        provider: settings.provider,
        model,
        status: 'laeuft',
        prompt: privacy.storeAiPrompts ? prompt.slice(0, 100_000) : null,
      })
      .returning({ id: aiJobs.id })
    jobId = job!.id
  }
  const runId = jobId

  logPipeline('solution.run.started', {
    jobId,
    runId,
    materialId,
    blankCount,
    taskCount: tasks.length,
  })
  logPipeline('document.normalized', {
    jobId,
    runId,
    textBlocks: documentModel.textBlocks.length,
    nativeFields: documentModel.nativeFields.length,
    pages: documentModel.pages.length,
  })
  if (candidateBank) {
    logPipeline('candidate_bank.detected', {
      jobId,
      runId,
      count: candidateBank.candidates.length,
      reusePolicy: candidateBank.reusePolicy,
      source: candidateBank.source,
      words: candidateBank.candidates.map((c) => c.value),
      repairedViaVision: candidateBankRepairedViaVision,
    })
    if (candidateBankRepairedViaVision) {
      logPipeline('candidate_bank.repaired', {
        jobId,
        runId,
        count: candidateBank.candidates.length,
        source: 'vision',
        words: candidateBank.candidates.map((c) => c.value),
      })
    }
  } else {
    const repairTask = tasks.find((t) => t.requiresCandidateBankRepair)
    if (repairTask) {
      logPipeline('candidate_bank.expected_but_missing', {
        jobId,
        runId,
        taskId: repairTask.id,
        instruction: repairTask.instruction.slice(0, 120),
        candidateBankStatus: repairTask.candidateBankStatus,
      })
    }
  }
  for (const task of tasks) {
    logPipeline('task.detected', {
      jobId,
      runId,
      taskId: task.id,
      page: task.page,
      kind: task.kind,
      targets: task.targets.length,
    })
    logPipeline('task.classified', {
      jobId,
      runId,
      taskId: task.id,
      page: task.page,
      kind: task.kind,
      confidence: task.confidence,
      reasons: task.evidence,
      renderMode: task.renderMode,
      candidateBankStatus: task.candidateBankStatus ?? null,
      requiresCandidateBankRepair: task.requiresCandidateBankRepair ?? false,
    })
  }

  try {
    let filled: FilledDocument | null = null
    const hermesUsed = false
    let attachments = 0
    let visionUsed = false
    let usedModel = model
    let structured: StructuredSolution | null = null
    let v2Result: PipelineV2Result | null = null

    await updateSolutionRunStage(jobId, 'normalizing', 12)
    let visualPdfBuffer: Buffer | null = null
    if (source?.extension === 'pdf') {
      visualPdfBuffer = source.buffer
    } else if (source?.extension === 'docx') {
      visualPdfBuffer = await convertOfficeBufferToPdf(source.buffer, source.fileName)
    }

    const layoutDocument = visualPdfBuffer
      ? await buildPdfLayoutDocumentV2(visualPdfBuffer, analysisDocumentText)
      : buildTextOnlyLayoutDocumentV2(
          analysisDocumentText || material.content || '',
          source?.buffer ?? `${materialId}:${analysisDocumentText}`,
        )
    await updateSolutionRunStage(jobId, 'planning', 30, {
      sourceHash: layoutDocument.sourceHash,
    })

    tasks = reconcileTasksWithPageLayoutV2(layoutDocument, tasks)
    let v2Build = buildSolutionPlanV2({
      document: layoutDocument,
      tasks,
      sourceFormat: source?.extension === 'pdf'
        ? 'pdf'
        : source?.extension === 'docx'
          ? 'docx'
          : 'other',
    })
    if (options.userInstructions?.trim()) {
      const teacherHint = options.userInstructions.trim()
      v2Build = {
        ...v2Build,
        plan: {
          ...v2Build.plan,
          tasks: v2Build.plan.tasks.map((task) => ({
            ...task,
            instruction: `${task.instruction}\nZusätzlicher Hinweis der Lehrkraft: ${teacherHint}`,
          })),
        },
      }
    }
    await updateSolutionRunStage(jobId, 'planning', 38, { plan: v2Build.plan })

    const pageParts: PageVisionPart[] = []
    if (useVision && visualPdfBuffer) {
      for (const page of layoutDocument.pages) {
        const [raster] = await rasterizePdf(visualPdfBuffer, { page: page.page, scale: 1.55 })
        if (!raster) continue
        pageParts.push({
          page: page.page,
          part: { type: 'image', mimeType: raster.mimeType, base64: raster.base64 },
        })
      }
    }
    attachments = pageParts.length
    visionUsed = pageParts.length > 0

    await updateSolutionRunStage(jobId, 'solving', 45)
    v2Result = await runSolutionPipelineV2({
      build: v2Build,
      settings,
      model,
      pageParts,
      requireVision: Boolean(visualPdfBuffer),
    })
    usedModel = v2Result.model
    structured = v2Result.projection.solution
    tasks = v2Result.projection.tasks
    await updateSolutionRunStage(jobId, 'validating', 68, {
      plan: v2Result.plan,
      solution: v2Result.solvedTasks,
      renderManifest: v2Result.projection.manifest,
      qualityReport: v2Result.qualityReport,
      issues: v2Result.qualityReport.issues,
    })

    const v2Blocked = v2Result.qualityReport.issues.some((issue) => issue.blocking)
    if (structured.answers.length > 0) {
      await updateSolutionRunStage(jobId, 'rendering', 76)
      const rendererMode: SolutionFillMode = tasks.some(
        (task) => task.renderMode === 'overlay' || task.renderMode === 'native',
      )
        ? 'lueckentext'
        : 'offen'
      filled = await buildFilledDocument(source, structured, material.title, rendererMode, tasks)
    }
    if (v2Blocked) {
      await saveSolutionDraft({
        jobId,
        file: filled
          ? { buffer: filled.buffer, fileName: filled.fileName, mimeType: filled.mimeType }
          : null,
        plan: v2Result.plan,
        solution: v2Result.solvedTasks,
        renderManifest: v2Result.projection.manifest,
        qualityReport: v2Result.qualityReport,
        issues: v2Result.qualityReport.issues,
      })
      throw new SolutionReviewRequiredError(v2Result.qualityReport.issues[0]?.message)
    }

    if (!filled) {
      throw appError('KI_FEHLER', 'Es konnte kein Lösungsdokument erzeugt werden.')
    }

    await updateSolutionRunStage(jobId, 'verifying', 86)
    let qualityVision: PdfSolutionQualityResult | null = null
    const renderedPdfBuffer = filled.mimeType === 'application/pdf'
      ? filled.buffer
      : filled.fileName.toLowerCase().endsWith('.docx')
        ? await convertOfficeBufferToPdf(filled.buffer, filled.fileName)
        : null
    if (visualPdfBuffer && renderedPdfBuffer && useVision && settings.enabled && model.trim()) {
      const choiceTargetIds = new Set(
        tasks
          .flatMap((task) => task.targets)
          .filter((target) => target.kind === 'choice_cell')
          .map((target) => target.id),
      )
      qualityVision = await verifyPdfSolutionViaVision({
        source: visualPdfBuffer,
        sourceFileName: source?.fileName ?? 'material.pdf',
        rendered: renderedPdfBuffer,
        renderedFileName: filled.fileName,
        settings,
        model,
        expectedOverlays: structured?.answers
          .filter(
            (answer) =>
              answer.bbox &&
              answer.page != null &&
              answer.page > 0,
          )
          .map((answer) => ({
            text:
              answer.targetId && choiceTargetIds.has(answer.targetId)
                ? 'X'
                : answer.answer,
            page: answer.page!,
            bbox: answer.bbox!,
          })) ?? [],
      })
      log.info('PDF-Musterlösung visuell qualitätsgeprüft', {
        status: qualityVision.status,
        issues: qualityVision.issues,
        model: qualityVision.model ?? null,
      })
    }

    if (!qualityVision) {
      qualityVision = {
        status: 'unavailable',
        issues: ['Die verpflichtende visuelle Endkontrolle konnte nicht ausgeführt werden.'],
        checkedAt: new Date().toISOString(),
      }
    }
    if (v2Result) {
      v2Result.qualityReport.render = qualityVision.status === 'passed' ? 'passed' : 'failed'
      if (qualityVision.status !== 'passed') {
        v2Result.qualityReport.issues.push({
          code: qualityVision.status === 'unavailable' ? 'VISION_UNAVAILABLE' : 'RENDER_QA_FAILED',
          message: qualityVision.issues[0] ?? 'Die visuelle Endkontrolle ist fehlgeschlagen.',
          blocking: true,
        })
        await saveSolutionDraft({
          jobId,
          file: { buffer: filled.buffer, fileName: filled.fileName, mimeType: filled.mimeType },
          plan: v2Result.plan,
          solution: v2Result.solvedTasks,
          renderManifest: v2Result.projection.manifest,
          qualityReport: v2Result.qualityReport,
          issues: v2Result.qualityReport.issues,
        })
        throw new SolutionReviewRequiredError(v2Result.qualityReport.issues.at(-1)?.message)
      }
    }

    await updateSolutionRunStage(jobId, 'publishing', 94)
    const summaryMd = [
      AI_CONTENT_NOTICE_MD,
      '',
      filled.summary,
      structured ? `\n${solutionToMarkdown(structured)}` : '',
      '',
      `_Erzeugt als Dokument (${filled.strategy})._`,
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 20_000)

    const authorCredit =
      kiAutorAnzeige({ model: usedModel, provider: settings.provider }) ??
      `KI · ${usedModel}`

    const solutionMaterialId = await createMaterial(
      {
        title: `Musterlösung – ${material.title}`,
        description: `Automatisch erstellte Musterlösung zum Material „${material.title}“.`,
        content: summaryMd,
        materialType: 'musterloesung',
        schoolForm: material.schoolForm,
        pages: material.pages,
        author: authorCredit,
        origin: 'ki',
        aiMeta: {
          provider: settings.provider,
          model: usedModel,
          generatedAt: new Date().toISOString(),
          sourceMaterialId: materialId,
          sourceVariantId: variant?.id ?? null,
          sourceAssetId: source?.id ?? null,
          promptVersion: 'solution-v2-solve-1',
          pipelineVersion: SOLUTION_PIPELINE_VERSION,
          solutionSchemaVersion: 2,
          reviewed: false,
          fillStrategy: filled.strategy,
          hermesUsed,
          layoutVisionChecked: pdfLayoutVisionChecked,
          layoutVisionRepaired: pdfLayoutRepairedViaVision,
          qualityVision: qualityVision ?? undefined,
          sourceFileName: source?.fileName,
          structuredSolution: structured
            ? { ...structured, schemaVersion: 2 }
            : null,
          solutionPlan: v2Result?.plan,
          renderManifest: v2Result?.projection.manifest,
          qualityReport: v2Result?.qualityReport,
        },
        subjectIds: material.subjects.map((s) => s.id),
        topicIds: material.topics.map((t) => t.id),
        competencyIds: material.competencies.map((c) => c.id),
        learningGroupIds: material.learningGroups.map((g) => g.id),
        gradeLevels: material.gradeLevels,
        tagNames: [...material.tags.map((t) => t.name), 'KI-Musterlösung'],
      },
      userId,
      db,
    )

    const [solutionVariant] = await db
      .select({ id: materialVariants.id })
      .from(materialVariants)
      .where(eq(materialVariants.materialId, solutionMaterialId))
      .limit(1)

    if (solutionVariant) {
      await addFileAsset(
        solutionVariant.id,
        { buffer: filled.buffer, fileName: filled.fileName },
        { role: 'haupt', title: 'Musterlösung (Dokument)' },
        db,
      )
    }

    await addRelation(materialId, solutionMaterialId, 'musterloesung', 'Automatisch erstellt', db)

    await db
      .update(aiJobs)
      .set({
        status: 'erfolgreich',
        result: filled.summary.slice(0, 200_000),
        resultMaterialId: solutionMaterialId,
        inputTokens: v2Result?.inputTokens,
        outputTokens: v2Result?.outputTokens,
        durationMs: Date.now() - startedAt,
        finishedAt: new Date(),
      })
      .where(eq(aiJobs.id, jobId))
    await completeSolutionRun(jobId)

    logPipeline('solution.run.completed', {
      jobId,
      runId,
      materialId,
      solutionMaterialId,
      strategy: filled.strategy,
      hermesUsed,
      durationMs: Date.now() - startedAt,
    })
    log.info('Musterlösung erzeugt', {
      materialId,
      solutionMaterialId,
      model: usedModel,
      strategy: filled.strategy,
      hermesUsed,
    })

    return {
      jobId,
      solutionMaterialId,
      model: usedModel,
      attachments,
      usedVision: visionUsed,
      fillStrategy: filled.strategy,
      hermesUsed,
      fileName: filled.fileName,
    }
  } catch (error) {
    if (error instanceof SolutionReviewRequiredError) {
      logPipeline('solution.run.review_required', {
        jobId,
        runId,
        materialId,
        durationMs: Date.now() - startedAt,
      })
      throw error
    }
    logPipeline('solution.run.failed', {
      jobId,
      runId,
      materialId,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { message: String(error) },
      durationMs: Date.now() - startedAt,
    })
    await db
      .update(aiJobs)
      .set({
        status: 'fehlgeschlagen',
        errorMessage: oeffentlicheFehlermeldung(
          error,
          'Die KI-Musterlösung konnte nicht erzeugt werden.',
        ),
        durationMs: Date.now() - startedAt,
        finishedAt: new Date(),
      })
      .where(eq(aiJobs.id, jobId))
    throw error
  }
}

function pickSolutionModel(
  settings: AiSettings,
  override: string | undefined,
  useVision: boolean,
): string {
  if (override?.trim()) return override.trim()
  if (useVision && settings.visionModel?.trim()) return settings.visionModel.trim()
  if (settings.chatModel?.trim()) return settings.chatModel.trim()
  throw appError('KI_NICHT_KONFIGURIERT', 'Es ist kein Sprach-/Vision-Modell konfiguriert.')
}

export async function loadPrimarySourceAsset(variantId: string): Promise<SourceAsset | null> {
  const db = useDatabase()
  const assets = await db
    .select()
    .from(materialAssets)
    .where(eq(materialAssets.variantId, variantId))

  const file =
    assets.find((a) => a.kind === 'datei' && a.role === 'haupt' && a.storageKey) ??
    assets.find((a) => a.kind === 'datei' && a.storageKey)

  if (!file?.storageKey || !file.fileName || !file.mimeType) return null
  if ((file.sizeBytes ?? 0) > MAX_ATTACHMENT_BYTES) {
    log.warn('Quelldatei zu groß für Dokumentfüllung', { assetId: file.id })
    return null
  }

  const buffer = await readFile(resolveStoragePath(file.storageKey))
  return {
    id: file.id,
    fileName: file.fileName,
    mimeType: file.mimeType,
    storageKey: file.storageKey,
    sizeBytes: file.sizeBytes,
    buffer,
    extension: extensionOf(file.fileName),
  }
}

export async function buildFilledDocument(
  source: SourceAsset | null,
  solution: StructuredSolution,
  materialTitle: string,
  fillMode: SolutionFillMode = 'lueckentext',
  tasks: TaskBlock[] = [],
): Promise<FilledDocument> {
  const title = `Musterlösung – ${materialTitle}`
  const sourceBaseName = source?.fileName ?? materialTitle
  const hasMixedRender =
    tasks.some((t) => t.renderMode === 'overlay' || t.renderMode === 'native') &&
    tasks.some((t) => t.renderMode === 'appendix')
  const hasInplaceRender = tasks.some(
    (task) => task.renderMode === 'overlay' || task.renderMode === 'native',
  )

  // Offene Aufgabe ohne Antwortfelder: separates blankes PDF (Aufgabennummer + Lösung).
  if (fillMode === 'offen' && !hasMixedRender && !hasInplaceRender) {
    if (source && PDF_EXTENSIONS.has(source.extension)) {
      const acro = await fillPdfAcroForm(source.buffer, solution)
      if (acro) {
        return {
          buffer: acro.buffer,
          fileName: solutionFileName(source.fileName, 'pdf'),
          mimeType: 'application/pdf',
          strategy: 'pdf_acroform',
          summary: solution.summary,
        }
      }
    }
    if (source?.extension === 'docx') {
      const rendered = renderDocxSolution(source.buffer, solution, {
        title,
        notice: AI_CONTENT_NOTICE,
        sourceFileName: source.fileName,
        tasks,
      })
      return rendered
    }

    const buffer = await buildAnswerListPdf(title, solution, { notice: AI_CONTENT_NOTICE })
    log.info('Separates Musterlösungs-PDF erzeugt', { answers: solution.answers.length })
    return {
      buffer,
      fileName: solutionFileName(sourceBaseName, 'pdf'),
      mimeType: 'application/pdf',
      strategy: 'pdf_separate',
      summary: solution.summary,
    }
  }

  if (source && OFFICE_EXTENSIONS.has(source.extension)) {
    if (source.extension === 'docx') {
      const rendered = renderDocxSolution(source.buffer, solution, {
        title,
        notice: AI_CONTENT_NOTICE,
        sourceFileName: source.fileName,
        tasks,
      })
      log.info('DOCX-Musterlösung befüllt', {
        strategy: rendered.strategy,
        answers: solution.answers.length,
      })
      logPipeline('render.task_completed', {
        strategy: rendered.strategy,
        tasks: tasks.length,
      })
      return rendered
    }

    const buffer = buildSolutionDocx(title, solution, { notice: AI_CONTENT_NOTICE })
    return {
      buffer,
      fileName: solutionFileName(source.fileName, 'docx'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      strategy: 'docx_from_structure',
      summary: solution.summary,
    }
  }

  if (source && PDF_EXTENSIONS.has(source.extension)) {
    // Aufgabenbasiert: Overlay + optionaler Anhang (pdf_hybrid).
    if (tasks.length > 0) {
      const rendered = await renderPdfSolution(source.buffer, solution, {
        title,
        notice: AI_CONTENT_NOTICE,
        sourceFileName: source.fileName,
        tasks,
      })
      log.info('PDF-Musterlösung gerendert', {
        strategy: rendered.strategy,
        answers: solution.answers.length,
        tasks: tasks.length,
      })
      logPipeline('render.task_completed', {
        strategy: rendered.strategy,
        tasks: tasks.length,
      })
      return {
        ...rendered,
        fileName: solutionFileName(source.fileName, 'pdf'),
      }
    }

    const acro = await fillPdfAcroForm(source.buffer, solution)
    if (acro) {
      return {
        buffer: acro.buffer,
        fileName: solutionFileName(source.fileName, 'pdf'),
        mimeType: 'application/pdf',
        strategy: 'pdf_acroform',
        summary: solution.summary,
      }
    }

    const overlay = await overlayPdfAnswers(source.buffer, solution)
    log.info('PDF-Overlay erzeugt', {
      overlays: overlay.overlays,
      usedGeometry: overlay.usedGeometry,
      usedBBox: overlay.usedBBox,
      answers: solution.answers.length,
    })
    return {
      buffer: overlay.buffer,
      fileName: solutionFileName(source.fileName, 'pdf'),
      mimeType: 'application/pdf',
      strategy: 'pdf_overlay',
      summary: solution.summary,
    }
  }

  const buffer = buildSolutionDocx(title, solution, { notice: AI_CONTENT_NOTICE })
  return {
    buffer,
    fileName: solutionFileName(materialTitle, 'docx'),
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    strategy: 'docx_from_structure',
    summary: solution.summary,
  }
}

/** Schreibt einen Office-Puffer temporär und konvertiert ihn per LibreOffice nach PDF. */
export async function convertOfficeBufferToPdf(
  buffer: Buffer,
  fileName: string,
): Promise<Buffer | null> {
  const workDir = await mkdtemp(join(tmpdir(), 'saru-sol-office-'))
  const safe =
    fileName.replace(/[^\w.\-()+äöüÄÖÜß ]/g, '_').slice(0, 120) || `datei.${extensionOf(fileName)}`
  const inputPath = join(workDir, safe)
  try {
    await writeFile(inputPath, buffer)
    return await convertOfficeFileToPdf(inputPath)
  } catch (error) {
    log.warn('Office→PDF für Musterlösung fehlgeschlagen', { fileName, error })
    return null
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function enrichFromPdfBuffer(
  buffer: Buffer,
  structured: StructuredSolution,
  blanks: PdfBlankRegion[],
): Promise<StructuredSolution> {
  try {
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true })
    const pageSizes = pdf.getPages().map((page) => page.getSize())
    return enrichSolutionPlacements(structured, blanks, pageSizes)
  } catch (error) {
    log.warn('Platzierungen konnten nicht angereichert werden', error)
    return {
      ...structured,
      answers: structured.answers.map((a) => ({
        ...a,
        fieldType:
          a.fieldType ?? (a.answer.length > 90 || /\n/.test(a.answer) ? 'freitext' : 'luecke'),
      })),
    }
  }
}

export interface UpdateSolutionOptions {
  structuredSolution: StructuredSolution
  /** PDF neu aus Quelldokument + Struktur zeichnen (Standard: true bei PDF-Overlay). */
  reRender?: boolean
  reviewed?: boolean
}

/**
 * Speichert korrigierte Antworten und erzeugt optional das Overlay-PDF neu.
 */
export async function updateSolutionStructure(
  materialId: string,
  userId: string,
  options: UpdateSolutionOptions,
): Promise<{ materialId: string; reRendered: boolean; fillStrategy: string | null }> {
  const db = useDatabase()
  const material = await getMaterialDetail(materialId, db)
  if (!material) throw appError('NICHT_GEFUNDEN', 'Das Material wurde nicht gefunden.')
  if (material.materialType !== 'musterloesung' || material.origin !== 'ki') {
    throw appError(
      'UNGUELTIGE_EINGABE',
      'Nur KI-Musterlösungen können so nachbearbeitet werden.',
    )
  }

  const meta = material.aiMeta ?? {}
  const sourceMaterialId = meta.sourceMaterialId
  if (!sourceMaterialId) {
    throw appError(
      'KI_FEHLER',
      'Zu dieser Musterlösung ist kein Quellmaterial hinterlegt – Neuzeichnen nicht möglich.',
    )
  }

  let structured = normalizeStructuredSolution(options.structuredSolution)
  const sourceMaterial = await getMaterialDetail(sourceMaterialId, db)
  if (!sourceMaterial) {
    throw appError('NICHT_GEFUNDEN', 'Das Quellmaterial der Musterlösung wurde nicht gefunden.')
  }

  const sourceVariant =
    sourceMaterial.variants.find((v) => v.id === meta.sourceVariantId) ??
    sourceMaterial.variants.find((v) => v.isDefault) ??
    sourceMaterial.variants[0]
  const source = sourceVariant ? await loadPrimarySourceAsset(sourceVariant.id) : null

  const fillStrategy = meta.fillStrategy ?? null
  const wantsRender = options.reRender !== false
  let reRendered = false
  let newStrategy = fillStrategy

  const storedFillMode: SolutionFillMode =
    meta.fillMode === 'offen' || meta.fillStrategy === 'pdf_separate'
      ? 'offen'
      : 'lueckentext'

  if (wantsRender && storedFillMode === 'offen') {
    const filled = await buildFilledDocument(
      source,
      structured,
      sourceMaterial.title,
      'offen',
    )
    await replaceHauptAsset(
      material,
      { buffer: filled.buffer, fileName: filled.fileName, mimeType: filled.mimeType },
      db,
    )
    reRendered = true
    newStrategy = filled.strategy
  } else if (wantsRender && source && PDF_EXTENSIONS.has(source.extension)) {
    // Antworten mit blankIndex an Geometrie ausrichten; manuell verschobene
    // (blankIndex = null) behalten ihre bbox. Anschließend preferBBox zeichnen.
    if (meta.solutionSchemaVersion !== 2 && structured.schemaVersion !== 2) {
      let blanks: PdfBlankRegion[] = []
      try {
        blanks = await detectPdfBlankRegions(source.buffer)
      } catch (error) {
        log.warn('Lückenerkennung beim Neuzeichnen fehlgeschlagen', error)
      }
      structured = await enrichFromPdfBuffer(source.buffer, structured, blanks)
    }
    const overlay = await overlayPdfAnswers(source.buffer, structured, { preferBBox: true })
    await replaceHauptAsset(
      material,
      {
        buffer: overlay.buffer,
        fileName: solutionFileName(source.fileName, 'pdf'),
        mimeType: 'application/pdf',
      },
      db,
    )
    reRendered = true
    newStrategy = 'pdf_overlay'
  } else if (wantsRender && source && OFFICE_EXTENSIONS.has(source.extension)) {
    const filled = await buildFilledDocument(
      source,
      structured,
      sourceMaterial.title,
      storedFillMode,
    )
    await replaceHauptAsset(
      material,
      { buffer: filled.buffer, fileName: filled.fileName, mimeType: filled.mimeType },
      db,
    )
    reRendered = true
    newStrategy = filled.strategy
  } else if (wantsRender && !source) {
    throw appError(
      'KI_FEHLER',
      'Die Quelldatei wurde nicht gefunden – das Dokument kann nicht neu erzeugt werden.',
    )
  }

  const summaryMd = [
    AI_CONTENT_NOTICE_MD,
    '',
    structured.summary,
    `\n${solutionToMarkdown(structured)}`,
    '',
    reRendered ? `_Dokument neu erzeugt (${newStrategy})._` : `_Struktur gespeichert._`,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 20_000)

  const authorCredit =
    kiAutorAnzeige({ model: meta.model, provider: meta.provider }, material.author) ??
    material.author

  const reviewed =
    options.reviewed !== undefined ? options.reviewed : Boolean(meta.reviewed)

  await updateMaterial(
    materialId,
    {
      content: summaryMd,
      author: authorCredit,
      aiMeta: {
        ...meta,
        structuredSolution: structured,
        fillStrategy: newStrategy ?? meta.fillStrategy,
        reviewed,
        reviewedAt: reviewed ? (meta.reviewedAt ?? new Date().toISOString()) : undefined,
        reviewedBy: reviewed ? (meta.reviewedBy ?? userId) : undefined,
        editedAt: new Date().toISOString(),
        editedBy: userId,
      },
    },
    db,
  )

  return { materialId, reRendered, fillStrategy: newStrategy }
}

async function replaceHauptAsset(
  material: NonNullable<Awaited<ReturnType<typeof getMaterialDetail>>>,
  file: { buffer: Buffer; fileName: string; mimeType: string },
  db: ReturnType<typeof useDatabase>,
): Promise<void> {
  const variant =
    material.variants.find((v) => v.isDefault) ?? material.variants[0]
  if (!variant) throw appError('KI_FEHLER', 'Die Lösungsvariante fehlt.')

  const oldHaupt =
    variant.assets.find((a) => a.kind === 'datei' && a.role === 'haupt') ??
    variant.assets.find((a) => a.kind === 'datei')

  if (oldHaupt) {
    await deleteAsset(oldHaupt.id, db)
  }

  await addFileAsset(
    variant.id,
    { buffer: file.buffer, fileName: file.fileName },
    { role: 'haupt', title: 'Musterlösung (Dokument)' },
    db,
  )
}

function normalizeStructuredSolution(raw: StructuredSolution): StructuredSolution {
  const answers: StructuredSolution['answers'] = []
  for (const [index, row] of (raw.answers ?? []).entries()) {
    const answer = String(row.answer ?? '').trim()
    if (!answer) continue
    const fieldRaw = String(row.fieldType ?? '').toLowerCase()
    const parsedType =
      fieldRaw === 'freitext' ? 'freitext' : fieldRaw === 'luecke' ? 'luecke' : null
    answers.push({
      id: String(row.id ?? index + 1),
      label: String(row.label ?? `Aufgabe ${index + 1}`).trim() || `Aufgabe ${index + 1}`,
      answer,
      page: typeof row.page === 'number' ? row.page : null,
      blankIndex: typeof row.blankIndex === 'number' ? row.blankIndex : null,
      leftContext: row.leftContext ? String(row.leftContext) : null,
      rightContext: row.rightContext ? String(row.rightContext) : null,
      bbox: row.bbox ?? null,
      targetId: row.targetId ? String(row.targetId) : null,
      fieldType:
        parsedType ??
        (answer.length > 90 || /\n/.test(answer) ? 'freitext' : 'luecke'),
    })
  }

  return {
    schemaVersion: raw.schemaVersion === 2 ? 2 : 1,
    summary: String(raw.summary ?? 'Korrigierte Musterlösung.').trim(),
    answers,
    formFields: Array.isArray(raw.formFields)
      ? raw.formFields
          .map((f) => ({
            name: String(f.name ?? '').trim(),
            value: String(f.value ?? '').trim(),
          }))
          .filter((f) => f.name && f.value)
      : [],
    notesForTeacher: raw.notesForTeacher ? String(raw.notesForTeacher) : null,
    uncertainties: raw.uncertainties ? String(raw.uncertainties) : null,
  }
}

/**
 * Liefert die strukturierte Lösung mit an PDF-Geometrie ausgerichteten bboxes
 * für den Korrektur-Editor (Browser-Vorschau ≈ Overlay-PDF).
 * Antworten ohne blankIndex (manuell verschoben) behalten ihre bbox.
 */
export async function prepareEditableSolutionStructure(
  materialId: string,
): Promise<StructuredSolution | null> {
  const material = await getMaterialDetail(materialId)
  if (!material?.aiMeta?.structuredSolution) return null

  let structured = normalizeStructuredSolution(material.aiMeta.structuredSolution)
  const meta = material.aiMeta
  if (meta.solutionSchemaVersion === 2 || structured.schemaVersion === 2) return structured
  const sourceMaterialId = meta.sourceMaterialId
  if (!sourceMaterialId) return structured

  const sourceMaterial = await getMaterialDetail(sourceMaterialId)
  if (!sourceMaterial) return structured

  const sourceVariant =
    sourceMaterial.variants.find((v) => v.id === meta.sourceVariantId) ??
    sourceMaterial.variants.find((v) => v.isDefault) ??
    sourceMaterial.variants[0]
  const source = sourceVariant ? await loadPrimarySourceAsset(sourceVariant.id) : null
  if (!source || !PDF_EXTENSIONS.has(source.extension)) return structured

  try {
    const blanks = await detectPdfBlankRegions(source.buffer)
    structured = await enrichFromPdfBuffer(source.buffer, structured, blanks)
  } catch (error) {
    log.warn('Editor-Platzierungen konnten nicht an Geometrie ausgerichtet werden', error)
  }
  return structured
}

/** Markiert eine KI-Musterlösung als fachlich geprüft. */
export async function markSolutionReviewed(
  materialId: string,
  userId: string,
  reviewed: boolean,
): Promise<void> {
  const db = useDatabase()
  const material = await getMaterialDetail(materialId, db)
  if (!material) throw appError('NICHT_GEFUNDEN', 'Das Material wurde nicht gefunden.')

  await updateMaterial(
    materialId,
    {
      aiMeta: {
        ...(material.aiMeta ?? {}),
        reviewed,
        reviewedAt: reviewed ? new Date().toISOString() : undefined,
        reviewedBy: reviewed ? userId : undefined,
      },
    },
    db,
  )
}
