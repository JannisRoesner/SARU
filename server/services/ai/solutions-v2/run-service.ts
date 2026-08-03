import { eq } from 'drizzle-orm'
import { aiJobs, aiSolutionRuns, type SolutionRunIssue, type SolutionRunStage } from '../../../database/schema'
import { useDatabase } from '../../../database/client'
import { storeFile } from '../../storage.service'
import type { QualityIssueV2 } from './types'

export class SolutionReviewRequiredError extends Error {
  readonly code = 'SOLUTION_REVIEW_REQUIRED'

  constructor(message = 'Die Musterlösung wurde als Prüfentwurf gespeichert.') {
    super(message)
    this.name = 'SolutionReviewRequiredError'
  }
}

export async function updateSolutionRunStage(
  jobId: string,
  stage: SolutionRunStage,
  progress: number,
  patch: Partial<{
    sourceHash: string | null
    plan: unknown
    solution: unknown
    renderManifest: unknown
    qualityReport: unknown
    issues: SolutionRunIssue[]
  }> = {},
): Promise<void> {
  const db = useDatabase()
  await db
    .update(aiSolutionRuns)
    .set({
      stage,
      progress: Math.max(0, Math.min(100, Math.round(progress))),
      heartbeatAt: new Date(),
      updatedAt: new Date(),
      ...patch,
    })
    .where(eq(aiSolutionRuns.jobId, jobId))
}

export async function heartbeatSolutionRun(jobId: string): Promise<void> {
  const db = useDatabase()
  await db
    .update(aiSolutionRuns)
    .set({ heartbeatAt: new Date(), updatedAt: new Date() })
    .where(eq(aiSolutionRuns.jobId, jobId))
}

export async function saveSolutionDraft(args: {
  jobId: string
  file?: { buffer: Buffer; fileName: string; mimeType: string } | null
  plan: unknown
  solution: unknown
  renderManifest: unknown
  qualityReport: unknown
  issues: QualityIssueV2[]
}): Promise<void> {
  const db = useDatabase()
  const stored = args.file ? await storeFile(args.file.buffer, args.file.fileName) : null
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(aiSolutionRuns)
      .set({
        stage: 'completed',
        progress: 100,
        plan: args.plan,
        solution: args.solution,
        renderManifest: args.renderManifest,
        qualityReport: args.qualityReport,
        issues: args.issues,
        draftStorageKey: stored?.storageKey ?? null,
        draftFileName: stored?.fileName ?? args.file?.fileName ?? null,
        draftMimeType: stored?.mimeType ?? args.file?.mimeType ?? null,
        heartbeatAt: now,
        updatedAt: now,
        finishedAt: now,
      })
      .where(eq(aiSolutionRuns.jobId, args.jobId))
    await tx
      .update(aiJobs)
      .set({
        status: 'pruefung_noetig',
        errorMessage: args.issues[0]?.message ?? 'Die Musterlösung benötigt eine manuelle Prüfung.',
        finishedAt: now,
      })
      .where(eq(aiJobs.id, args.jobId))
  })
}

export async function completeSolutionRun(jobId: string): Promise<void> {
  await updateSolutionRunStage(jobId, 'completed', 100)
  const db = useDatabase()
  await db
    .update(aiSolutionRuns)
    .set({ finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(aiSolutionRuns.jobId, jobId))
}
