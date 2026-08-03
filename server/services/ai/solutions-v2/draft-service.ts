import { and, eq } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { aiJobs, aiSolutionRuns, materialVariants } from '../../../database/schema'
import { useDatabase } from '../../../database/client'
import { getMaterialDetail } from '../../../repositories/material.repository'
import { appError } from '../../../utils/errors'
import { addFileAsset, addRelation, createMaterial } from '../../material.service'
import { deleteFile, resolveStoragePath, storeFile } from '../../storage.service'
import { rendererTasksFromPlanV2 } from './plan-builder'
import { rasterizePdf } from '../rasterize'
import { projectSolutionForRenderV2, validateRenderManifestV2 } from './renderer-projection'
import { validateSolvedTaskV2 } from './solution-validator'
import type { QualityIssueV2, QualityReportV2, SolutionPlanV2, SolvedTask } from './types'

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
  if (!row.run.draftStorageKey || !row.run.draftFileName) {
    throw appError('NICHT_GEFUNDEN', 'Für diesen Prüfentwurf existiert keine Seitenvorschau.')
  }
  const source = await readFile(resolveStoragePath(row.run.draftStorageKey))
  const isPdf = row.run.draftMimeType === 'application/pdf'
    || row.run.draftFileName.toLocaleLowerCase('de-DE').endsWith('.pdf')
  const pdf = isPdf
    ? source
    : await (await import('../solutions')).convertOfficeBufferToPdf(source, row.run.draftFileName)
  if (!pdf) throw appError('KI_FEHLER', 'Die Entwurfsseite konnte nicht gerendert werden.')
  const [raster] = await rasterizePdf(pdf, { page, scale: 1.6 })
  if (!raster) throw appError('NICHT_GEFUNDEN', 'Die angeforderte Entwurfsseite existiert nicht.')
  return { buffer: Buffer.from(raster.base64, 'base64'), mimeType: raster.mimeType }
}
