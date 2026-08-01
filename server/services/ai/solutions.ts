import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { useDatabase } from '../../database/client'
import { aiJobs, materialAssets, materialVariants } from '../../database/schema'
import { oeffentlicheFehlermeldung } from '#shared/utils/public-error'
import { appError } from '../../utils/errors'
import { createLogger } from '../../utils/logger'
import { materialTypes, schoolForms } from '#shared/utils/labels'
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
  getHermesSettings,
  getPrivacySettings,
  type AiSettings,
} from '../settings.service'
import { chatCompletion, supportsNativePdf, type ChatPart } from './client'
import { PDFDocument } from 'pdf-lib'
import {
  alignAnswersToBlanks,
  buildAnswerListPdf,
  buildSolutionDocx,
  detectDocxBlanks,
  detectPdfBlankRegions,
  enrichSolutionPlacements,
  fillPdfAcroForm,
  formatBlankInventory,
  formatTextBlankInventory,
  overlayPdfAnswers,
  parseStructuredSolution,
  solutionFileName,
  solutionToMarkdown,
  summarizeAnswersForLog,
  summarizeBlanksForLog,
  textBlanksAsAlignable,
  type FilledDocument,
  type PdfBlankRegion,
  type SolutionFillMode,
  type StructuredSolution,
  type TextBlankInfo,
} from './document-fill'
import { kiAutorAnzeige } from '#shared/utils/ki'
import { tryHermesDocumentFill } from './hermes'
import {
  AI_CONTENT_NOTICE,
  AI_CONTENT_NOTICE_MD,
  SOLUTION_PROMPT_VERSION,
  buildSolutionPrompt,
  solutionSystemPromptForMode,
} from './prompts'
import { rasterizePdf } from './rasterize'
import { ensureExtractedText } from './document-text'
import { analyzeDocxTargets } from './solutions/docx-analyzer'
import { logPipeline } from './solutions/logging'
import { buildSolutionPlan } from './solutions/orchestrator'
import { detectPdfAnswerLines } from './solutions/pdf-answer-lines'
import { buildClozeRepairPrompt } from './solutions/repair/cloze-repair'
import { repairCandidateBankViaVision } from './solutions/repair/candidate-bank-vision'
import { repairDocxTargetsViaVision } from './solutions/repair/docx-targets-vision'
import { mergeNativeAndVisualTargets } from './solutions/docx-target-merger'
import { renderPdfSolution } from './solutions/renderers/pdf-renderer'
import { renderDocxSolution } from './solutions/renderers/docx-renderer'
import { coerceAnswersToNumbers } from './solutions/number-matching'
import {
  detectWorksheetTasks,
  formatWorksheetTasksForPrompt,
} from './solutions/worksheet-tasks'
import { assignCandidatesGlobally } from './solutions/solvers/cloze-solver'
import { applyFreeTextTaskMeta } from './solutions/solvers/free-text-solver'
import type { CandidateBank, TaskBlock } from './solutions/types'
import { validateClozeAnswers } from './solutions/validators/cloze-validator'
import {
  assertClozeValidationPassed,
  hasPlaceholderAnswers,
} from './solutions/validators/validation-gate'

const log = createLogger('ai:solutions')

/** Obergrenze für an das Modell übergebene Dateien – schützt vor sehr großen Anhängen. */
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024
const MAX_VISION_PAGES = 8

const OFFICE_EXTENSIONS = new Set(['docx', 'odt', 'doc', 'rtf'])
const PDF_EXTENSIONS = new Set(['pdf'])
/** Office-Formate, die LibreOffice für Vision/Vorschau nach PDF wandeln kann. */
const OFFICE_VISION_EXTENSIONS = new Set([
  'docx',
  'doc',
  'odt',
  'rtf',
  'pptx',
  'ppt',
  'odp',
  'xlsx',
  'xls',
  'ods',
])

export interface GenerateSolutionOptions {
  /** Nur diese Variante berücksichtigen; sonst die Standardfassung. */
  variantId?: string | null
  userInstructions?: string | null
  /** Bilder/PDFs mitschicken, sofern der Anbieter das kann. */
  useVision?: boolean
  model?: string
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

interface SourceAsset {
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
  const hermes = await getHermesSettings()

  if (!settings.enabled && !(hermes.enabled && hermes.baseUrl.trim())) {
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

  // PDF-Arbeitsblätter brauchen Seitenbilder für Lückenpositionen (bbox).
  const forceVisionForPdf = Boolean(source && PDF_EXTENSIONS.has(source.extension))
  const useVision = options.useVision ?? (settings.useVision || forceVisionForPdf)
  const model = pickSolutionModel(settings, options.model, useVision, {
    allowEmpty: hermes.enabled && Boolean(hermes.baseUrl.trim()),
  })

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

  let pdfAnswerLines: Awaited<ReturnType<typeof detectPdfAnswerLines>> = {
    targets: [],
    shapes: [],
    rawLineCount: 0,
    clusterCount: 0,
  }
  // Nur wenn keine Text-Lücken gefunden wurden – Cloze bleibt prioritär.
  if (
    source &&
    PDF_EXTENSIONS.has(source.extension) &&
    detectedBlanks.length === 0
  ) {
    try {
      pdfAnswerLines = await detectPdfAnswerLines(source.buffer)
      if (pdfAnswerLines.clusterCount > 0) {
        log.info('PDF-Antwortlinien erkannt', {
          rawLines: pdfAnswerLines.rawLineCount,
          clusters: pdfAnswerLines.clusterCount,
        })
      }
    } catch (error) {
      log.warn('PDF-Antwortlinien-Erkennung fehlgeschlagen', error)
    }
  }

  const plan = buildSolutionPlan({
    documentText: textForAnalysis || pdfExtractText || docxNative.fullText,
    pdfText: pdfExtractText || null,
    pdfBlanks: detectedBlanks,
    docxBlanks,
    nativeFields: docxNative.nativeFields,
    shapes: [...docxNative.shapes, ...pdfAnswerLines.shapes],
    answerTargets: [...docxNative.targets, ...pdfAnswerLines.targets],
  })
  let {
    tasks,
    candidateBank,
    fillMode,
    blankCount,
    document: documentModel,
    numberMatching,
  } = plan

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

  log.info('Musterlösungs-Füllmodus', {
    fillMode,
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

  const blankInventory =
    fillMode === 'lueckentext'
      ? detectedBlanks.length
        ? formatBlankInventory(detectedBlanks)
        : docxBlanks.length
          ? formatTextBlankInventory(docxBlanks)
          : null
      : null

  const diagramTask = tasks.find((t) => t.kind === 'diagram_completion')
  const answerLineCount =
    pdfAnswerLines.clusterCount ||
    tasks
      .flatMap((t) => t.targets)
      .filter((t) => t.kind === 'answer_line').length ||
    null
  const worksheetUnits = detectWorksheetTasks(
    documentText || documentModel.fullText || '',
  )
  const taskInventory = worksheetUnits.length
    ? formatWorksheetTasksForPrompt(worksheetUnits)
    : tasks
        .filter(
          (t) =>
            t.kind === 'free_text_separate' || t.kind === 'matching_inline',
        )
        .map((t, i) => `${i + 1}. ${t.instruction}`)
        .join('\n') || null
  const prompt = buildSolutionPrompt({
    title: material.title,
    description: material.description,
    materialType: materialTypes.label(material.materialType),
    subjects: material.subjects.map((s) => s.name),
    gradeLevels: material.gradeLevels,
    schoolForm: material.schoolForm ? schoolForms.label(material.schoolForm) : null,
    topics: material.topics.map((t) => t.name),
    competencies: material.competencies.map((c) => c.name),
    learningObjectives: material.learningObjectives,
    pages: material.pages,
    documentText: documentText || null,
    userInstructions: options.userInstructions,
    sourceFileName: source?.fileName ?? null,
    sourceMimeType: source?.mimeType ?? null,
    blankInventory,
    detectedBlankCount: fillMode === 'lueckentext' ? blankCount || null : null,
    fillMode,
    candidateBank,
    diagramTargetIds: diagramTask?.targets.map((t) => t.id) ?? null,
    answerLineCount,
    numberMatching,
    taskInventory,
  })

  if (!documentText && !source && !material.content?.trim()) {
    throw appError(
      'KI_FEHLER',
      'Zu diesem Material liegt weder eine Datei noch auslesbarer Text vor. Bitte eine Datei hinterlegen.',
    )
  }

  const privacy = await getPrivacySettings()
  const startedAt = Date.now()

  const [job] = await db
    .insert(aiJobs)
    .values({
      userId,
      materialId,
      kind: 'musterloesung',
      // Enum kennt nur OpenAI-kompatible Anbieter; Hermes wird in aiMeta vermerkt.
      provider: settings.provider,
      model,
      status: 'laeuft',
      prompt: privacy.storeAiPrompts ? prompt.slice(0, 100_000) : null,
    })
    .returning({ id: aiJobs.id })

  const jobId = job!.id
  const runId = jobId

  logPipeline('solution.run.started', {
    jobId,
    runId,
    materialId,
    fillMode,
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
    let hermesUsed = false
    let attachments = 0
    let visionUsed = false
    let usedModel = model
    let structured: StructuredSolution | null = null

    // 1) Optional: Hermes document-fill (agentisch, ausgefülltes Dokument zurück).
    if (source && hermes.enabled && hermes.baseUrl.trim()) {
      const hermesResult = await tryHermesDocumentFill(hermes, {
        task: 'fill_solution',
        instructions: [
          prompt,
          options.userInstructions?.trim() ? `\nHinweise: ${options.userInstructions.trim()}` : '',
        ].join(''),
        fileName: source.fileName,
        mimeType: source.mimeType,
        documentBase64: source.buffer.toString('base64'),
        meta: {
          title: material.title,
          materialId,
          subjects: material.subjects.map((s) => s.name),
          gradeLevels: material.gradeLevels,
        },
      })

      if (hermesResult) {
        hermesUsed = true
        usedModel = hermesResult.model
        filled = {
          buffer: hermesResult.buffer,
          fileName: hermesResult.fileName || solutionFileName(source.fileName, extensionOf(hermesResult.fileName || source.fileName)),
          mimeType: hermesResult.mimeType,
          strategy: 'hermes',
          summary: hermesResult.summary,
        }
      }
    }

    // 2) Lokaler Pfad: multimodales Modell → strukturierte Antworten → Dokument füllen.
    if (!filled) {
      if (!settings.enabled) {
        throw appError(
          'KI_NICHT_KONFIGURIERT',
          hermes.enabled
            ? 'Hermes konnte kein Dokument liefern und die lokale KI ist nicht aktiviert.'
            : 'Die KI-Unterstützung ist nicht aktiviert. Bitte in den Einstellungen einrichten.',
        )
      }

      const parts: ChatPart[] = [{ type: 'text', text: prompt }]
      if (useVision && variant) {
        const media = await collectVisionParts(variant.id, settings.provider)
        parts.push(...media.parts)
        attachments = media.parts.length
        visionUsed = media.parts.length > 0
        if (media.skipped.length) {
          log.info('Einige Anhänge wurden nicht an das Modell übergeben', {
            skipped: media.skipped,
          })
        }
      }

      // Textinhalt als zusätzliche Grundlage, falls keine Vision/Datei.
      if (!documentText && !visionUsed && material.content?.trim()) {
        parts.push({
          type: 'text',
          text: `\n\n## Manueller Inhalt\n\n${material.content.trim().slice(0, 40_000)}`,
        })
      }

      if (!documentText && !visionUsed && !material.content?.trim() && !source) {
        throw appError(
          'KI_FEHLER',
          'Zu diesem Material liegt weder auslesbarer Text noch eine übertragbare Datei vor.',
        )
      }

      // Viele Lücken → verbose JSON; Token-Budget an Inventargröße anpassen.
      const solutionMaxTokens = Math.min(
        32_000,
        Math.max(settings.maxOutputTokens || 4000, 1200 + blankCount * 220),
      )

      const completion = await chatCompletion(
        settings,
        [
          {
            role: 'system',
            parts: [{ type: 'text', text: solutionSystemPromptForMode(fillMode) }],
          },
          { role: 'user', parts },
        ],
        { model, maxOutputTokens: solutionMaxTokens },
      )

      usedModel = completion.model
      structured = parseStructuredSolution(completion.text)
      log.info('Modell-Antworten (roh)', {
        count: structured.answers.length,
        answers: summarizeAnswersForLog(structured.answers),
      })
      // Begriffe → Nummern, falls die Aufgabe Nummern verlangt.
      if (numberMatching) {
        structured = coerceAnswersToNumbers(structured, numberMatching)
        log.info('Nummern-Zuordnung: Antworten auf Ziffern normalisiert', {
          answers: summarizeAnswersForLog(structured.answers),
        })
      }
      if (fillMode === 'offen') {
        structured = {
          ...structured,
          answers: structured.answers.map((a) => ({
            ...a,
            fieldType: 'freitext' as const,
            blankIndex: null,
            leftContext: null,
            rightContext: null,
            bbox: null,
          })),
        }
      } else if (detectedBlanks.length > 0) {
        structured = alignAnswersToBlanks(structured, detectedBlanks)
        log.info('Antworten an erkannte Lücken ausgerichtet', {
          answers: structured.answers.length,
          blanks: detectedBlanks.length,
          mapping: structured.answers.map((a) => ({
            blankIndex: a.blankIndex,
            label: a.label,
            answer: a.answer,
            left: a.leftContext,
            right: a.rightContext,
          })),
        })
      } else if (docxBlanks.length > 0) {
        // DOCX: dieselbe Kontext-Ausrichtung wie bei PDF (nicht nur Positions-Slice).
        structured = alignAnswersToBlanks(structured, textBlanksAsAlignable(docxBlanks))
        log.info('DOCX-Antworten an Lückeninventar gebunden', {
          mapping: summarizeAnswersForLog(structured.answers),
        })
      }

      // Wortlisten-Validierung + optional ein Repair-Pass + globale Zuordnung.
      if (fillMode === 'lueckentext' && candidateBank && blankCount > 0) {
        structured = await enforceCandidateBankConstraints({
          structured,
          candidateBank,
          blankCount,
          blanks: detectedBlanks.length
            ? detectedBlanks
            : docxBlanks,
          settings,
          model,
          jobId,
          runId,
        })
      }

      // Sicherheit: keine ???-Platzhalter als fertige Musterlösung speichern.
      if (hasPlaceholderAnswers(structured.answers)) {
        logPipeline('solution.run.failed', {
          jobId,
          runId,
          errorCode: 'CLOZE_VALIDATION_FAILED_AFTER_REPAIR',
          reason: 'placeholder_answers',
        })
        throw appError(
          'UNGUELTIGE_EINGABE',
          'Die Musterlösung konnte nicht zuverlässig gegen die Wortliste validiert werden. Es wurde keine verwendbare Musterlösung erstellt.',
          { details: { errorCode: 'CLOZE_VALIDATION_FAILED_AFTER_REPAIR' } },
        )
      }

      structured = applyFreeTextTaskMeta(structured, tasks)

      for (const task of tasks) {
        logPipeline('task.solved', {
          jobId,
          runId,
          taskId: task.id,
          kind: task.kind,
          answers: structured.answers.length,
        })
      }

      if (source && PDF_EXTENSIONS.has(source.extension)) {
        structured = await enrichFromPdfBuffer(
          source.buffer,
          structured,
          fillMode === 'lueckentext' ? detectedBlanks : [],
        )
      } else {
        structured = {
          ...structured,
          answers: structured.answers.map((a) => ({
            ...a,
            fieldType:
              a.fieldType ??
              (fillMode === 'offen' || a.answer.length > 90 || /\n/.test(a.answer)
                ? 'freitext'
                : 'luecke'),
          })),
        }
      }
      filled = await buildFilledDocument(source, structured, material.title, fillMode, tasks)
    }

    if (!filled) {
      throw appError('KI_FEHLER', 'Es konnte kein Lösungsdokument erzeugt werden.')
    }

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
      kiAutorAnzeige({ model: usedModel, provider: hermesUsed ? 'hermes' : settings.provider }) ??
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
          provider: hermesUsed ? 'hermes' : settings.provider,
          model: usedModel,
          generatedAt: new Date().toISOString(),
          sourceMaterialId: materialId,
          sourceVariantId: variant?.id ?? null,
          sourceAssetId: source?.id ?? null,
          promptVersion: SOLUTION_PROMPT_VERSION,
          reviewed: false,
          fillMode,
          fillStrategy: filled.strategy,
          hermesUsed,
          sourceFileName: source?.fileName,
          structuredSolution: structured,
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
        durationMs: Date.now() - startedAt,
        finishedAt: new Date(),
      })
      .where(eq(aiJobs.id, jobId))

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
  options: { allowEmpty?: boolean } = {},
): string {
  if (override?.trim()) return override.trim()
  if (useVision && settings.visionModel?.trim()) return settings.visionModel.trim()
  if (settings.chatModel?.trim()) return settings.chatModel.trim()
  if (options.allowEmpty) return 'hermes-agent'
  throw appError('KI_NICHT_KONFIGURIERT', 'Es ist kein Sprach-/Vision-Modell konfiguriert.')
}

async function loadPrimarySourceAsset(variantId: string): Promise<SourceAsset | null> {
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

/**
 * Validiert gegen die Wortliste, führt max. einen Repair-Pass aus und
 * erzwingt bei reusePolicy „once“ eine globale bijektive Zuordnung.
 * Wirft bei endgültigem Validierungsfehler – kein ???-Material.
 */
async function enforceCandidateBankConstraints(args: {
  structured: StructuredSolution
  candidateBank: CandidateBank
  blankCount: number
  blanks: Array<PdfBlankRegion | TextBlankInfo>
  settings: AiSettings
  model: string
  jobId: string
  runId: string
}): Promise<StructuredSolution> {
  const { candidateBank, blankCount, blanks, settings, model, jobId, runId } = args
  let structured = args.structured
  const clozeTaskId = 'p1-t1'

  let validation = validateClozeAnswers(structured, candidateBank, blankCount)
  if (!validation.valid) {
    logPipeline('task.validation_failed', {
      jobId,
      runId,
      taskId: clozeTaskId,
      violations: validation.violations,
    })
    logPipeline('task.repair_started', {
      jobId,
      runId,
      taskId: clozeTaskId,
      reason: 'candidate_bank_constraints',
    })

    const repairPrompt = buildClozeRepairPrompt({
      bank: candidateBank,
      blanks,
      validation,
      previousAnswers: structured,
    })

    try {
      const repairCompletion = await chatCompletion(
        settings,
        [
          {
            role: 'system',
            parts: [{ type: 'text', text: solutionSystemPromptForMode('lueckentext') }],
          },
          { role: 'user', parts: [{ type: 'text', text: repairPrompt }] },
        ],
        { model, maxOutputTokens: settings.maxOutputTokens },
      )
      const repaired = parseStructuredSolution(repairCompletion.text)
      const pdfBlanks = blanks.filter((b): b is PdfBlankRegion => 'pageIndex' in b)
      structured =
        pdfBlanks.length > 0
          ? alignAnswersToBlanks(repaired, pdfBlanks)
          : {
              ...repaired,
              answers: repaired.answers.slice(0, blankCount).map((a, i) => ({
                ...a,
                blankIndex: i,
                leftContext: blanks[i] && 'leftText' in blanks[i]! ? blanks[i]!.leftText : a.leftContext,
                rightContext:
                  blanks[i] && 'rightText' in blanks[i]! ? blanks[i]!.rightText : a.rightContext,
              })),
            }
      validation = validateClozeAnswers(structured, candidateBank, blankCount)
    } catch (error) {
      log.warn('Wortlisten-Repair fehlgeschlagen', error)
    }
  }

  // Globale Zuordnung bei once-Policy – kann Fehlzuordnungen korrigieren.
  if (candidateBank.reusePolicy === 'once') {
    const frames = blanks.map((b) => ({
      blankIndex: b.blankIndex,
      leftText: 'leftText' in b ? b.leftText : '',
      rightText: 'rightText' in b ? b.rightText : '',
      page: 'pageIndex' in b ? b.pageIndex + 1 : 1,
    }))
    structured = assignCandidatesGlobally(structured, candidateBank, frames)
    validation = validateClozeAnswers(structured, candidateBank, blankCount)
    if (validation.valid) {
      logPipeline('task.validation_passed', {
        jobId,
        runId,
        taskId: clozeTaskId,
        via: 'global_assignment',
        answers: structured.answers.length,
      })
      return structured
    }
  }

  if (validation.valid) {
    logPipeline('task.validation_passed', {
      jobId,
      runId,
      taskId: clozeTaskId,
      answers: structured.answers.length,
    })
    return structured
  }

  logPipeline('task.validation_failed', {
    jobId,
    runId,
    taskId: clozeTaskId,
    violations: validation.violations,
    afterRepair: true,
  })
  logPipeline('solution.run.failed', {
    jobId,
    runId,
    taskId: clozeTaskId,
    errorCode: 'CLOZE_VALIDATION_FAILED_AFTER_REPAIR',
    violations: validation.violations,
  })
  assertClozeValidationPassed(validation)
  return structured
}

async function buildFilledDocument(
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

  // Offene Aufgabe ohne Antwortfelder: separates blankes PDF (Aufgabennummer + Lösung).
  if (fillMode === 'offen' && !hasMixedRender) {
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

/**
 * Bereitet die Dateien einer Variante für das Modell auf.
 * PDFs gehen direkt an Anbieter, die das unterstützen; andernfalls werden die
 * ersten Seiten als Bilder gerendert (typisch für multimodale Ollama-Modelle).
 */
async function collectVisionParts(
  variantId: string,
  provider: 'openai' | 'ollama' | 'openrouter',
): Promise<{ parts: ChatPart[]; skipped: string[] }> {
  const db = useDatabase()
  const assets = await db
    .select()
    .from(materialAssets)
    .where(eq(materialAssets.variantId, variantId))

  const parts: ChatPart[] = []
  const skipped: string[] = []

  for (const asset of assets) {
    if (asset.kind !== 'datei' || !asset.storageKey || !asset.mimeType) continue
    if ((asset.sizeBytes ?? 0) > MAX_ATTACHMENT_BYTES) {
      skipped.push(`${asset.fileName} (zu groß)`)
      continue
    }

    try {
      const buffer = await readFile(resolveStoragePath(asset.storageKey))

      if (asset.mimeType.startsWith('image/') && asset.mimeType !== 'image/svg+xml') {
        parts.push({ type: 'image', mimeType: asset.mimeType, base64: buffer.toString('base64') })
        continue
      }

      if (asset.mimeType === 'application/pdf') {
        if (supportsNativePdf(provider)) {
          parts.push({
            type: 'file',
            mimeType: 'application/pdf',
            base64: buffer.toString('base64'),
            fileName: asset.fileName ?? 'material.pdf',
          })
        } else {
          // Multimodale lokale Modelle (z. B. gemma4): Seiten als Bilder.
          const pages = await rasterizePdf(buffer, { maxPages: MAX_VISION_PAGES })
          if (pages.length === 0) {
            skipped.push(`${asset.fileName} (Bildumwandlung nicht möglich)`)
            continue
          }
          for (const page of pages) {
            parts.push({ type: 'image', mimeType: page.mimeType, base64: page.base64 })
          }
        }
        continue
      }

      const ext = extensionOf(asset.fileName ?? '')
      if (OFFICE_VISION_EXTENSIONS.has(ext)) {
        const pdfBuffer = await convertOfficeBufferToPdf(buffer, asset.fileName ?? `datei.${ext}`)
        if (!pdfBuffer) {
          skipped.push(`${asset.fileName} (Office→PDF nicht möglich – Text kommt separat)`)
          continue
        }
        if (supportsNativePdf(provider)) {
          parts.push({
            type: 'file',
            mimeType: 'application/pdf',
            base64: pdfBuffer.toString('base64'),
            fileName: (asset.fileName ?? 'material').replace(/\.[^.]+$/, '') + '.pdf',
          })
        } else {
          const pages = await rasterizePdf(pdfBuffer, { maxPages: MAX_VISION_PAGES })
          if (pages.length === 0) {
            skipped.push(`${asset.fileName} (Bildumwandlung nach Office→PDF nicht möglich)`)
            continue
          }
          for (const page of pages) {
            parts.push({ type: 'image', mimeType: page.mimeType, base64: page.base64 })
          }
        }
        continue
      }

      skipped.push(`${asset.fileName} (Format wird nicht als Bild übergeben)`)
    } catch (error) {
      log.warn('Anhang konnte nicht gelesen werden', { assetId: asset.id, error })
      skipped.push(asset.fileName ?? asset.id)
    }
  }

  return { parts, skipped }
}

/** Schreibt einen Office-Puffer temporär und konvertiert ihn per LibreOffice nach PDF. */
async function convertOfficeBufferToPdf(
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
    let blanks: PdfBlankRegion[] = []
    try {
      blanks = await detectPdfBlankRegions(source.buffer)
    } catch (error) {
      log.warn('Lückenerkennung beim Neuzeichnen fehlgeschlagen', error)
    }
    structured = await enrichFromPdfBuffer(source.buffer, structured, blanks)
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
      fieldType:
        parsedType ??
        (answer.length > 90 || /\n/.test(answer) ? 'freitext' : 'luecke'),
    })
  }

  return {
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
