import { and, eq } from 'drizzle-orm'
import { aiJobs, aiSolutionRuns } from '../../../database/schema'
import { useDatabase } from '../../../database/client'
import { requireEditor } from '../../../utils/auth'
import { notFound } from '../../../utils/errors'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const [draft] = await useDatabase()
    .select({
      id: aiSolutionRuns.id,
      jobId: aiSolutionRuns.jobId,
      publishedMaterialId: aiJobs.resultMaterialId,
      stage: aiSolutionRuns.stage,
      plan: aiSolutionRuns.plan,
      solution: aiSolutionRuns.solution,
      renderManifest: aiSolutionRuns.renderManifest,
      qualityReport: aiSolutionRuns.qualityReport,
      issues: aiSolutionRuns.issues,
      hasFile: aiSolutionRuns.draftStorageKey,
      fileName: aiSolutionRuns.draftFileName,
    })
    .from(aiSolutionRuns)
    .innerJoin(aiJobs, eq(aiJobs.id, aiSolutionRuns.jobId))
    .where(and(eq(aiSolutionRuns.id, id), eq(aiJobs.userId, user.id)))
    .limit(1)
  if (!draft) throw notFound('Der Prüfentwurf')
  return { draft: { ...draft, hasFile: Boolean(draft.hasFile) } }
})
