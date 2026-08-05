import { and, eq } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { aiJobs, aiSolutionRuns, materialVariants } from '../../../database/schema'
import { useDatabase } from '../../../database/client'
import { getMaterialDetail } from '../../../repositories/material.repository'
import { appError } from '../../../utils/errors'
import { addFileAsset, addRelation, createMaterial } from '../../material.service'
import { deleteFile, resolveStoragePath, storeFile } from '../../storage.service'
import { getAiSettings } from '../../settings.service'
import { candidateBankFromWords } from '../solutions/candidate-bank'
import {
  assessPdfLayoutPlan,
  repairPdfLayoutViaVision,
} from '../solutions/repair/pdf-layout-vision'
import { buildSolutionPlanV2, rendererTasksFromPlanV2 } from './plan-builder'
import { rasterizePdf } from '../rasterize'
import { runSolutionPipelineV2, type PageVisionPart } from './pipeline'
import { validateSolutionPlanV2 } from './plan-validator'
import { projectSolutionForRenderV2, validateRenderManifestV2 } from './renderer-projection'
import { validateSolvedTaskV2 } from './solution-validator'
import type {
  AnswerSlot,
  QualityIssueV2,
  QualityReportV2,
  SolutionPlanV2,
  SolvedTask,
  TaskKindV2,
  TaskSpec,
} from './types'

const NON_OVERRIDABLE = new Set([
  'NO_TASKS_DETECTED',
  'TASK_TARGETS_MISSING',
  'TARGET_ASSIGNED_MULTIPLE_TIMES',
  'TARGET_GEOMETRY_INVALID',
  'MODEL_TASK_ID_MISMATCH',
  'MODEL_EXTRA_TARGET',
  'MODEL_DUPLICATE_TARGET',
  'ANSWER_EMPTY',
  'ANSWER_NOT_ALLOWED',
  'ANSWER_OUT_OF_CANDIDATE_BANK',
  'ANSWER_EXCEEDS_CAPACITY',
  'ANSWERS_PARTIAL',
  'CANDIDATE_REUSED',
  'CANDIDATE_UNUSED',
  'CANDIDATE_RANKINGS_INCOMPLETE',
  'MODEL_OUTPUT_INCOMPLETE',
  'RENDER_TARGET_DUPLICATE',
  'RENDER_TARGET_OUTSIDE_PAGE',
  'RENDER_MANIFEST_INCOMPLETE',
])

function fillStrategyForPlan(
  plan: SolutionPlanV2,
  sourceFileName: string | null | undefined,
): string {
  const policies = plan.tasks.flatMap((task) => task.answerSlots.map((slot) => slot.renderPolicy))
  const hasAppendix = policies.includes('appendix')
  const hasInplace = policies.some((policy) => policy !== 'appendix')
  const isDocx = sourceFileName?.toLocaleLowerCase('de-DE').endsWith('.docx') ?? false
  if (isDocx) {
    if (hasAppendix && hasInplace) return 'docx_mixed'
    return hasAppendix ? 'docx_appended' : 'docx_inplace'
  }
  if (hasAppendix && hasInplace) return 'pdf_hybrid'
  return hasAppendix ? 'pdf_separate' : 'pdf_overlay'
}

async function ownedRun(runId: string, userId: string) {
  const [row] = await useDatabase()
    .select({ run: aiSolutionRuns, job: aiJobs })
    .from(aiSolutionRuns)
    .innerJoin(aiJobs, eq(aiJobs.id, aiSolutionRuns.jobId))
    .where(and(eq(aiSolutionRuns.id, runId), eq(aiJobs.userId, userId)))
    .limit(1)
  if (!row) throw appError('NICHT_GEFUNDEN', 'Der Prüfentwurf wurde nicht gefunden.')
  return row
}

function parseRunArtifacts(row: Awaited<ReturnType<typeof ownedRun>>): {
  plan: SolutionPlanV2
  solvedTasks: SolvedTask[]
  quality: QualityReportV2
} {
  const plan = row.run.plan as SolutionPlanV2 | null
  const solvedTasks = row.run.solution as SolvedTask[] | null
  const quality = row.run.qualityReport as QualityReportV2 | null
  if (!plan || plan.schemaVersion !== 2 || !Array.isArray(solvedTasks) || !quality) {
    throw appError('UNGUELTIGE_EINGABE', 'Der Prüfentwurf enthält keinen vollständigen V2-Vertrag.')
  }
  return { plan, solvedTasks, quality }
}

export interface RetrySolutionDraftTaskInput {
  kind: Exclude<TaskKindV2, 'unsupported'>
  instruction: string
  candidateValues?: string[]
  redetectTargets?: boolean
  answerSlots?: Array<{
    targetId?: string
    page: number
    bbox: { x: number; y: number; w: number; h: number } | null
    promptContext?: string
  }>
}

function targetKindFor(kind: RetrySolutionDraftTaskInput['kind']): AnswerSlot['targetKind'] {
  if (kind === 'cloze') return 'blank'
  if (kind === 'table_completion') return 'table_cell'
  if (kind === 'single_choice' || kind === 'multi_choice') return 'choice_cell'
  if (kind === 'diagram_labeling' || kind === 'matching') return 'shape_box'
  return 'answer_line'
}

function valueTypeFor(kind: RetrySolutionDraftTaskInput['kind']): AnswerSlot['valueType'] {
  if (kind === 'single_choice' || kind === 'multi_choice') return 'choice'
  if (kind === 'diagram_labeling' || kind === 'matching') return 'label'
  return 'text'
}

function manualSlots(
  task: TaskSpec,
  input: RetrySolutionDraftTaskInput,
  candidateIds: string[] | undefined,
): AnswerSlot[] {
  const raw = input.answerSlots ?? task.answerSlots
  const seen = new Set<string>()
  return raw.map((slot, index) => {
    let targetId = slot.targetId?.trim() || `${task.taskId}-manual-${index + 1}`
    while (seen.has(targetId)) targetId = `${targetId}-${index + 1}`
    seen.add(targetId)
    const bbox = slot.bbox
    const maxLines = bbox
      ? Math.max(1, Math.min(20, Math.floor((bbox.h ?? 0.025) / 0.025)))
      : 20
    const allowedValues = input.kind === 'single_choice' || input.kind === 'multi_choice'
      ? (input.candidateValues?.length ? input.candidateValues : ['richtig', 'falsch'])
      : undefined
    return {
      targetId,
      page: Math.max(1, Math.floor(slot.page || task.page)),
      bbox,
      promptContext: slot.promptContext?.trim() || input.instruction,
      targetKind: targetKindFor(input.kind),
      blankIndex: input.kind === 'cloze' ? index : null,
      nativeRef: null,
      cellRef: null,
      choiceValue: null,
      valueType: valueTypeFor(input.kind),
      allowedValues,
      candidateIds,
      renderPolicy: bbox
        ? input.kind === 'single_choice' || input.kind === 'multi_choice'
          ? 'pdf_mark_overlay'
          : 'pdf_text_overlay'
        : 'appendix',
      capacity: {
        maxLines,
        maxChars: bbox
          ? Math.max(12, Math.floor((bbox.w ?? 0.1) * 105 * maxLines))
          : 1200,
      },
      provenance: [{ source: 'manual', sourceRef: targetId }],
    }
  })
}

function legacyKindFor(kind: RetrySolutionDraftTaskInput['kind']) {
  if (kind === 'cloze') return 'cloze' as const
  if (kind === 'free_text') return 'free_text_inplace' as const
  if (kind === 'matching') return 'matching_inline' as const
  if (kind === 'diagram_labeling') return 'diagram_completion' as const
  return 'matching_table' as const
}

function sourceFormat(fileName: string | null | undefined): 'pdf' | 'docx' | 'other' {
  const lower = fileName?.toLocaleLowerCase('de-DE') ?? ''
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.docx')) return 'docx'
  return 'other'
}

export async function retrySolutionDraftTask(
  runId: string,
  userId: string,
  taskId: string,
  input: RetrySolutionDraftTaskInput,
): Promise<{ fileName: string; issues: QualityIssueV2[] }> {
  const row = await ownedRun(runId, userId)
  const artifacts = parseRunArtifacts(row)
  const existingTask = artifacts.plan.tasks.find((task) => task.taskId === taskId)
  if (!existingTask && !taskId.startsWith('manual-task-')) {
    throw appError('NICHT_GEFUNDEN', 'Die Teilaufgabe wurde nicht gefunden.')
  }
  const firstInputSlot = input.answerSlots?.[0]
  const previousTask: TaskSpec = existingTask ?? {
    taskId,
    kind: input.kind,
    page: firstInputSlot?.page ?? 1,
    instruction: input.instruction,
    instructionBBox: firstInputSlot?.bbox ?? null,
    confidence: 1,
    issues: [],
    candidateBank: null,
    answerSlots: [],
  }
  if (!row.job.materialId) throw appError('NICHT_GEFUNDEN', 'Das Quellmaterial wurde nicht gefunden.')

  const material = await getMaterialDetail(row.job.materialId)
  if (!material) throw appError('NICHT_GEFUNDEN', 'Das Quellmaterial wurde nicht gefunden.')
  const options = row.run.options as { variantId?: string | null }
  const variant = material.variants.find((candidate) => candidate.id === options.variantId)
    ?? material.variants.find((candidate) => candidate.isDefault)
    ?? material.variants[0]
  const { convertOfficeBufferToPdf, loadPrimarySourceAsset } = await import('../solutions')
  const source = variant ? await loadPrimarySourceAsset(variant.id) : null

  const words = (input.candidateValues ?? previousTask.candidateBank?.candidates.map((entry) => entry.value) ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
  const bank = words.length >= 2
    ? candidateBankFromWords(words, input.answerSlots?.length ?? previousTask.answerSlots.length, 'instruction')
    : null
  let editedTask: TaskSpec = {
    ...previousTask,
    kind: input.kind,
    instruction: input.instruction.trim(),
    confidence: 1,
    issues: [],
    candidateBank: bank,
    answerSlots: manualSlots(previousTask, input, bank?.candidates.map((entry) => entry.id)),
  }

  let visualPdf: Buffer | null = null
  if (source?.extension === 'pdf') visualPdf = source.buffer
  else if (source?.extension === 'docx') {
    visualPdf = await convertOfficeBufferToPdf(source.buffer, source.fileName)
  }

  const settings = {
    ...await getAiSettings(),
    provider: row.job.provider,
  }
  if (input.redetectTargets) {
    if (!visualPdf || !source) {
      throw appError('UNGUELTIGE_EINGABE', 'Für dieses Dokument ist keine visuelle Zielerkennung verfügbar.')
    }
    const legacyTask = rendererTasksFromPlanV2({
      ...artifacts.plan,
      tasks: [editedTask],
    })[0]!
    const visual = await repairPdfLayoutViaVision({
      buffer: visualPdf,
      fileName: source.fileName,
      settings,
      model: row.job.model,
      documentText: artifacts.plan.document.fullText,
      tasks: [legacyTask],
      assessment: assessPdfLayoutPlan({
        documentText: artifacts.plan.document.fullText,
        tasks: [legacyTask],
        requireVision: true,
      }),
      focus: input.kind === 'diagram_labeling' ? 'diagram_targets' : 'task_targets',
      expectedDiagramTargetCount: input.kind === 'diagram_labeling' && bank
        ? bank.candidates.length
        : undefined,
    })
    const visualTask = visual?.tasks.find((task) => task.targets.length > 0)
    if (!visualTask) {
      throw appError('KI_FEHLER', 'Die KI konnte für diese Aufgabe keine sicheren Zielbereiche erkennen.')
    }
    if (
      input.kind === 'diagram_labeling' &&
      bank &&
      visualTask.targets.length !== bank.candidates.length
    ) {
      throw appError(
        'KI_FEHLER',
        `Erkannt wurden ${visualTask.targets.length} Zielbereiche, erwartet werden ${bank.candidates.length}.`,
      )
    }
    const rebuilt = buildSolutionPlanV2({
      document: artifacts.plan.document,
      sourceFormat: sourceFormat(source.fileName),
      tasks: [{
        ...visualTask,
        id: previousTask.taskId,
        page: previousTask.page,
        instruction: editedTask.instruction,
        kind: legacyKindFor(input.kind),
        candidateBank: bank ?? undefined,
      }],
    }).plan.tasks[0]!
    editedTask = { ...rebuilt, taskId: previousTask.taskId, kind: input.kind }
  }

  const selectedPlan: SolutionPlanV2 = {
    ...artifacts.plan,
    tasks: [editedTask],
  }
  const selectedBuild = {
    plan: selectedPlan,
    rendererTasks: rendererTasksFromPlanV2(selectedPlan),
  }
  const pageParts: PageVisionPart[] = []
  if (visualPdf) {
    const [page] = await rasterizePdf(visualPdf, { page: editedTask.page, scale: 1.55 })
    if (page) {
      pageParts.push({
        page: editedTask.page,
        part: { type: 'image', mimeType: page.mimeType, base64: page.base64 },
      })
    }
  }
  const result = await runSolutionPipelineV2({
    build: selectedBuild,
    settings,
    model: row.job.model,
    pageParts,
    requireVision: Boolean(visualPdf),
  })
  const solved = result.solvedTasks.find((task) => task.taskId === editedTask.taskId)
  if (!solved) {
    throw appError('KI_FEHLER', result.qualityReport.issues[0]?.message ?? 'Die Aufgabe konnte nicht neu gelöst werden.')
  }

  const plan: SolutionPlanV2 = {
    ...artifacts.plan,
    tasks: existingTask
      ? artifacts.plan.tasks.map((task) => task.taskId === taskId ? editedTask : task)
      : [...artifacts.plan.tasks, editedTask],
  }
  const planIssues = validateSolutionPlanV2(plan)
  if (planIssues.some((issue) => issue.blocking)) {
    throw appError('UNGUELTIGE_EINGABE', planIssues[0]!.message, {
      details: { errorCode: planIssues[0]!.code, issues: planIssues },
    })
  }
  const solvedTasks = [
    ...artifacts.solvedTasks.filter((task) => task.taskId !== taskId),
    solved,
  ]
  const missingIssues: QualityIssueV2[] = plan.tasks
    .filter((task) => !solvedTasks.some((candidate) => candidate.taskId === task.taskId))
    .map((task) => ({
      code: 'ANSWERS_PARTIAL',
      message: 'Diese Teilaufgabe muss noch neu gelöst oder manuell ergänzt werden.',
      taskId: task.taskId,
      blocking: true,
    }))
  const retainedIssues = artifacts.quality.issues.filter((issue) =>
    issue.taskId !== taskId && !NON_OVERRIDABLE.has(issue.code),
  )
  const rendererTasks = rendererTasksFromPlanV2(plan)
  const projection = projectSolutionForRenderV2({ plan, rendererTasks, solvedTasks })
  const renderIssues: QualityIssueV2[] = validateRenderManifestV2(projection).map((issue) => ({
    ...issue,
    blocking: true,
  }))
  const issues = [
    ...retainedIssues,
    ...result.qualityReport.issues,
    ...missingIssues,
    ...renderIssues,
  ]
  const quality: QualityReportV2 = {
    ...artifacts.quality,
    plan: 'passed',
    structure: missingIssues.length > 0 || result.qualityReport.structure === 'failed'
      ? 'failed'
      : 'passed',
    semantic: result.qualityReport.semantic,
    render: renderIssues.length > 0 ? 'failed' : 'warning',
    issues,
  }
  const rendererMode = rendererTasks.some((task) => task.renderMode !== 'appendix')
    ? 'lueckentext' as const
    : 'offen' as const
  const { buildFilledDocument } = await import('../solutions')
  const filled = await buildFilledDocument(
    source,
    projection.solution,
    material.title,
    rendererMode,
    rendererTasks,
  )
  const stored = await storeFile(filled.buffer, filled.fileName)
  const oldStorageKey = row.run.draftStorageKey
  await useDatabase()
    .update(aiSolutionRuns)
    .set({
      plan,
      solution: solvedTasks,
      renderManifest: projection.manifest,
      qualityReport: quality,
      issues,
      draftStorageKey: stored.storageKey,
      draftFileName: stored.fileName,
      draftMimeType: stored.mimeType,
      updatedAt: new Date(),
    })
    .where(eq(aiSolutionRuns.id, runId))
  if (oldStorageKey && oldStorageKey !== stored.storageKey) await deleteFile(oldStorageKey)
  return { fileName: stored.fileName, issues }
}

export async function updateSolutionDraft(
  runId: string,
  userId: string,
  solvedTasks: SolvedTask[],
): Promise<{ fileName: string; issues: QualityIssueV2[] }> {
  const row = await ownedRun(runId, userId)
  const artifacts = parseRunArtifacts(row)
  const structuralIssues = artifacts.plan.tasks.flatMap((task) => {
    const solved = solvedTasks.find((candidate) => candidate.taskId === task.taskId)
    return solved
      ? validateSolvedTaskV2(task, solved)
      : [{
          code: 'ANSWERS_PARTIAL',
          message: 'Eine Teilaufgabe fehlt vollständig.',
          taskId: task.taskId,
          blocking: true,
        } satisfies QualityIssueV2]
  })
  if (structuralIssues.some((issue) => issue.blocking)) {
    throw appError('UNGUELTIGE_EINGABE', structuralIssues[0]!.message, {
      details: { errorCode: structuralIssues[0]!.code, issues: structuralIssues },
    })
  }

  const rendererTasks = rendererTasksFromPlanV2(artifacts.plan)
  const projection = projectSolutionForRenderV2({
    plan: artifacts.plan,
    rendererTasks,
    solvedTasks,
  })
  const renderIssues = validateRenderManifestV2(projection).map((issue) => ({
    ...issue,
    blocking: true,
  }))
  if (renderIssues.length > 0) {
    throw appError('UNGUELTIGE_EINGABE', renderIssues[0]!.message, {
      details: { errorCode: renderIssues[0]!.code, issues: renderIssues },
    })
  }

  if (!row.job.materialId) throw appError('NICHT_GEFUNDEN', 'Das Quellmaterial wurde nicht gefunden.')
  const material = await getMaterialDetail(row.job.materialId)
  if (!material) throw appError('NICHT_GEFUNDEN', 'Das Quellmaterial wurde nicht gefunden.')
  const options = row.run.options as { variantId?: string | null }
  const variant = material.variants.find((candidate) => candidate.id === options.variantId)
    ?? material.variants.find((candidate) => candidate.isDefault)
    ?? material.variants[0]
  const { buildFilledDocument, loadPrimarySourceAsset } = await import('../solutions')
  const source = variant ? await loadPrimarySourceAsset(variant.id) : null
  const rendererMode = rendererTasks.some((task) => task.renderMode !== 'appendix')
    ? 'lueckentext' as const
    : 'offen' as const
  const filled = await buildFilledDocument(
    source,
    projection.solution,
    material.title,
    rendererMode,
    rendererTasks,
  )
  const stored = await storeFile(filled.buffer, filled.fileName)
  const oldStorageKey = row.run.draftStorageKey
  const retainedIssues = artifacts.quality.issues.filter((issue) =>
    !NON_OVERRIDABLE.has(issue.code),
  )
  const quality: QualityReportV2 = {
    ...artifacts.quality,
    structure: 'passed',
    render: 'warning',
    issues: retainedIssues,
  }
  await useDatabase()
    .update(aiSolutionRuns)
    .set({
      solution: solvedTasks,
      renderManifest: projection.manifest,
      qualityReport: quality,
      issues: retainedIssues,
      draftStorageKey: stored.storageKey,
      draftFileName: stored.fileName,
      draftMimeType: stored.mimeType,
      updatedAt: new Date(),
    })
    .where(eq(aiSolutionRuns.id, runId))
  if (oldStorageKey && oldStorageKey !== stored.storageKey) await deleteFile(oldStorageKey)
  return { fileName: stored.fileName, issues: retainedIssues }
}

export async function publishSolutionDraft(
  runId: string,
  userId: string,
): Promise<{ solutionMaterialId: string }> {
  const row = await ownedRun(runId, userId)
  const { plan, solvedTasks, quality } = parseRunArtifacts(row)
  const blockingIssue = quality.issues.find((issue) => NON_OVERRIDABLE.has(issue.code))
  if (blockingIssue) {
    throw appError('UNGUELTIGE_EINGABE', blockingIssue.message, {
      details: { errorCode: blockingIssue.code },
    })
  }
  if (!row.run.draftStorageKey || !row.run.draftFileName || !row.job.materialId) {
    throw appError('UNGUELTIGE_EINGABE', 'Der Prüfentwurf besitzt keine veröffentlichbare Datei.')
  }
  const material = await getMaterialDetail(row.job.materialId)
  if (!material) throw appError('NICHT_GEFUNDEN', 'Das Quellmaterial wurde nicht gefunden.')
  const options = row.run.options as { variantId?: string | null }
  const sourceVariant = material.variants.find((candidate) => candidate.id === options.variantId)
    ?? material.variants.find((candidate) => candidate.isDefault)
    ?? material.variants[0]
  const sourceAsset = sourceVariant?.assets.find((asset) => asset.role === 'haupt' && asset.kind === 'datei')
    ?? sourceVariant?.assets.find((asset) => asset.kind === 'datei')
  const fillStrategy = fillStrategyForPlan(plan, sourceAsset?.fileName)
  const content = solvedTasks.flatMap((task) => task.answers)
    .map((answer) => `- ${answer.value}`)
    .join('\n')
    .slice(0, 18_000)
  const now = new Date()
  const solutionMaterialId = await createMaterial({
    title: `Musterlösung – ${material.title}`,
    description: `Manuell geprüfter KI-Entwurf zum Material „${material.title}“.`,
    content: `> **Von künstlicher Intelligenz erstellt und manuell freigegeben.**\n\n${content}`,
    materialType: 'musterloesung',
    schoolForm: material.schoolForm,
    pages: material.pages,
    author: `KI · ${row.job.model}`,
    origin: 'ki',
    aiMeta: {
      provider: row.job.provider,
      model: row.job.model,
      generatedAt: now.toISOString(),
      sourceMaterialId: material.id,
      promptVersion: 'solution-v2-solve-1',
      pipelineVersion: '2',
      solutionSchemaVersion: 2,
      reviewed: true,
      reviewedAt: now.toISOString(),
      reviewedBy: userId,
      sourceFileName: sourceAsset?.fileName ?? undefined,
      sourceVariantId: sourceVariant?.id ?? null,
      sourceAssetId: sourceAsset?.id ?? null,
      fillStrategy,
      structuredSolution: projectSolutionForRenderV2({
        plan,
        rendererTasks: rendererTasksFromPlanV2(plan),
        solvedTasks,
      }).solution,
      solutionPlan: plan,
      renderManifest: row.run.renderManifest,
      qualityReport: quality,
    },
    subjectIds: material.subjects.map((subject) => subject.id),
    topicIds: material.topics.map((topic) => topic.id),
    competencyIds: material.competencies.map((competency) => competency.id),
    learningGroupIds: material.learningGroups.map((group) => group.id),
    gradeLevels: material.gradeLevels,
    tagNames: [...material.tags.map((tag) => tag.name), 'KI-Musterlösung'],
  }, userId)
  const [variant] = await useDatabase()
    .select({ id: materialVariants.id })
    .from(materialVariants)
    .where(eq(materialVariants.materialId, solutionMaterialId))
    .limit(1)
  if (!variant) throw appError('KI_FEHLER', 'Die Lösungsvariante konnte nicht angelegt werden.')
  const buffer = await readFile(resolveStoragePath(row.run.draftStorageKey))
  await addFileAsset(
    variant.id,
    { buffer, fileName: row.run.draftFileName },
    { role: 'haupt', title: 'Musterlösung (manuell freigegeben)' },
  )
  await addRelation(material.id, solutionMaterialId, 'musterloesung', 'KI-Entwurf manuell freigegeben')
  await useDatabase().transaction(async (tx) => {
    await tx
      .update(aiJobs)
      .set({
        status: 'erfolgreich',
        resultMaterialId: solutionMaterialId,
        errorMessage: null,
        finishedAt: now,
      })
      .where(eq(aiJobs.id, row.job.id))
    await tx
      .update(aiSolutionRuns)
      .set({
        stage: 'completed',
        progress: 100,
        finishedAt: now,
        updatedAt: now,
        draftStorageKey: null,
        draftFileName: null,
        draftMimeType: null,
      })
      .where(eq(aiSolutionRuns.id, runId))
  })
  await deleteFile(row.run.draftStorageKey).catch(() => undefined)
  return { solutionMaterialId }
}

export async function discardSolutionDraft(runId: string, userId: string): Promise<void> {
  const row = await ownedRun(runId, userId)
  if (row.run.draftStorageKey) await deleteFile(row.run.draftStorageKey)
  await useDatabase().transaction(async (tx) => {
    await tx
      .update(aiJobs)
      .set({
        status: 'fehlgeschlagen',
        errorMessage: 'Der Prüfentwurf wurde verworfen.',
        finishedAt: new Date(),
      })
      .where(eq(aiJobs.id, row.job.id))
    await tx.delete(aiSolutionRuns).where(eq(aiSolutionRuns.id, runId))
  })
}

export async function getSolutionDraftPage(
  runId: string,
  userId: string,
  page: number,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const row = await ownedRun(runId, userId)
  let source: Buffer
  let fileName: string
  let mimeType: string | null
  if (row.run.draftStorageKey && row.run.draftFileName) {
    source = await readFile(resolveStoragePath(row.run.draftStorageKey))
    fileName = row.run.draftFileName
    mimeType = row.run.draftMimeType
  } else {
    if (!row.job.materialId) {
      throw appError('NICHT_GEFUNDEN', 'Für diesen Prüfentwurf existiert keine Seitenvorschau.')
    }
    const material = await getMaterialDetail(row.job.materialId)
    const options = row.run.options as { variantId?: string | null }
    const variant = material?.variants.find((candidate) => candidate.id === options.variantId)
      ?? material?.variants.find((candidate) => candidate.isDefault)
      ?? material?.variants[0]
    const { loadPrimarySourceAsset } = await import('../solutions')
    const original = variant ? await loadPrimarySourceAsset(variant.id) : null
    if (!original) {
      throw appError('NICHT_GEFUNDEN', 'Für diesen Prüfentwurf existiert keine Seitenvorschau.')
    }
    source = original.buffer
    fileName = original.fileName
    mimeType = original.mimeType
  }
  const isPdf = mimeType === 'application/pdf'
    || fileName.toLocaleLowerCase('de-DE').endsWith('.pdf')
  const pdf = isPdf
    ? source
    : await (await import('../solutions')).convertOfficeBufferToPdf(source, fileName)
  if (!pdf) throw appError('KI_FEHLER', 'Die Entwurfsseite konnte nicht gerendert werden.')
  const [raster] = await rasterizePdf(pdf, { page, scale: 1.6 })
  if (!raster) throw appError('NICHT_GEFUNDEN', 'Die angeforderte Entwurfsseite existiert nicht.')
  return { buffer: Buffer.from(raster.base64, 'base64'), mimeType: raster.mimeType }
}
