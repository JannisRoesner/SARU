import { and, desc, eq } from 'drizzle-orm'
import { aiJobs, materials } from '../../../database/schema'
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
    })
    .from(aiJobs)
    .leftJoin(materials, eq(aiJobs.resultMaterialId, materials.id))
    .where(and(eq(aiJobs.materialId, materialId), eq(aiJobs.userId, user.id), eq(aiJobs.kind, 'musterloesung')))
    .orderBy(desc(aiJobs.createdAt))
    .limit(1)

  return {
    job: job
      ? {
          ...job,
          qualityVision: job.aiMeta?.qualityVision ?? null,
        }
      : null,
  }
})
