import { and, desc, eq } from 'drizzle-orm'
import { aiJobs, aiSolutionRuns, materials } from '../../../database/schema'
import { useDatabase } from '../../../database/client'
import { requireEditor } from '../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/** Aktuellen oder letzten Musterlösungsjob eines Materials für das Status-Polling liefern. */
export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const materialId = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const db = useDatabase()
  const [job] = await db
    .select({
      id: aiJobs.id,
      status: aiJobs.status,
      resultMaterialId: aiJobs.resultMaterialId,
      errorMessage: aiJobs.errorMessage,
      createdAt: aiJobs.createdAt,
      finishedAt: aiJobs.finishedAt,
      aiMeta: materials.aiMeta,
      runId: aiSolutionRuns.id,
      stage: aiSolutionRuns.stage,
      progress: aiSolutionRuns.progress,
      issues: aiSolutionRuns.issues,
      hasDraftFile: aiSolutionRuns.draftStorageKey,
    })
    .from(aiJobs)
    .leftJoin(materials, eq(aiJobs.resultMaterialId, materials.id))
    .leftJoin(aiSolutionRuns, eq(aiSolutionRuns.jobId, aiJobs.id))
    .where(and(eq(aiJobs.materialId, materialId), eq(aiJobs.userId, user.id), eq(aiJobs.kind, 'musterloesung')))
    .orderBy(desc(aiJobs.createdAt))
    .limit(1)

  return {
    job: job
      ? {
          ...job,
          qualityVision: job.aiMeta?.qualityVision ?? null,
          stage: job.stage ?? null,
          progress: job.progress ?? 0,
          issues: job.issues ?? [],
          draftId: job.status === 'pruefung_noetig' ? job.runId : null,
          hasDraftFile: Boolean(job.hasDraftFile),
        }
      : null,
  }
})
