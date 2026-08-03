import { and, asc, eq, inArray, isNull, lt, or } from 'drizzle-orm'
import { aiJobs, aiSolutionRuns } from '../../../database/schema'
import { useDatabase } from '../../../database/client'
import { createLogger } from '../../../utils/logger'
import { recordAudit } from '../../audit.service'
import { heartbeatSolutionRun } from './run-service'

const log = createLogger('ai:solution-worker')
const POLL_MS = 2_000
const STALE_AFTER_MS = 5 * 60_000
const MAX_ATTEMPTS = 3

let polling = false
let interval: ReturnType<typeof setInterval> | null = null

async function recoverStaleRuns(): Promise<void> {
  const db = useDatabase()
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS)
  const stale = await db
    .select({ jobId: aiSolutionRuns.jobId, attempts: aiSolutionRuns.attempts })
    .from(aiSolutionRuns)
    .innerJoin(aiJobs, eq(aiJobs.id, aiSolutionRuns.jobId))
    .where(and(
      eq(aiJobs.status, 'laeuft'),
      or(isNull(aiSolutionRuns.heartbeatAt), lt(aiSolutionRuns.heartbeatAt, staleBefore)),
    ))
  for (const run of stale) {
    const exhausted = run.attempts >= MAX_ATTEMPTS
    await db
      .update(aiJobs)
      .set({
        status: exhausted ? 'fehlgeschlagen' : 'wartend',
        errorMessage: exhausted
          ? 'Der Hintergrundlauf wurde nach mehreren Serverabbrüchen beendet.'
          : null,
        finishedAt: exhausted ? new Date() : null,
      })
      .where(eq(aiJobs.id, run.jobId))
  }
}

async function claimNextJob(): Promise<{
  jobId: string
  materialId: string
  userId: string | null
  options: Record<string, unknown>
  attempt: number
} | null> {
  const db = useDatabase()
  const candidates = await db
    .select({
      jobId: aiJobs.id,
      materialId: aiJobs.materialId,
      userId: aiJobs.userId,
      options: aiSolutionRuns.options,
      attempts: aiSolutionRuns.attempts,
    })
    .from(aiJobs)
    .innerJoin(aiSolutionRuns, eq(aiSolutionRuns.jobId, aiJobs.id))
    .where(and(eq(aiJobs.kind, 'musterloesung'), eq(aiJobs.status, 'wartend')))
    .orderBy(asc(aiJobs.createdAt))
    .limit(4)
  for (const candidate of candidates) {
    if (!candidate.materialId) continue
    if (candidate.attempts >= MAX_ATTEMPTS) {
      await db
        .update(aiJobs)
        .set({
          status: 'fehlgeschlagen',
          errorMessage: 'Der Hintergrundlauf hat die maximale Anzahl an Versuchen erreicht.',
          finishedAt: new Date(),
        })
        .where(and(eq(aiJobs.id, candidate.jobId), eq(aiJobs.status, 'wartend')))
      continue
    }
    const attempt = candidate.attempts + 1
    const claimed = await db.transaction(async (tx) => {
      const rows = await tx
        .update(aiJobs)
        .set({ status: 'laeuft', errorMessage: null, finishedAt: null })
        .where(and(eq(aiJobs.id, candidate.jobId), eq(aiJobs.status, 'wartend')))
        .returning({ id: aiJobs.id })
      if (rows.length === 0) return false
      const now = new Date()
      await tx
        .update(aiSolutionRuns)
        .set({ attempts: attempt, heartbeatAt: now, updatedAt: now })
        .where(eq(aiSolutionRuns.jobId, candidate.jobId))
      return true
    })
    if (!claimed) continue
    return {
      jobId: candidate.jobId,
      materialId: candidate.materialId,
      userId: candidate.userId,
      options: candidate.options,
      attempt,
    }
  }
  return null
}

async function poll(): Promise<void> {
  if (polling) return
  polling = true
  try {
    while (true) {
      const claimed = await claimNextJob()
      if (!claimed) break
      const { generateSolution } = await import('../solutions')
      const heartbeat = setInterval(
        () => void heartbeatSolutionRun(claimed.jobId).catch((error) =>
          log.warn('Heartbeat des Musterlösungsjobs fehlgeschlagen', { jobId: claimed.jobId, error })),
        30_000,
      )
      heartbeat.unref?.()
      try {
        const result = await generateSolution(claimed.materialId, claimed.userId, {
          ...(claimed.options as Record<string, unknown>),
          jobId: claimed.jobId,
        })
        await recordAudit({
          userId: claimed.userId,
          action: 'ki.musterloesung_erzeugt',
          entityType: 'material',
          entityId: claimed.materialId,
          details: {
            modell: result.model,
            loesung: result.solutionMaterialId,
            strategie: result.fillStrategy,
            pipeline: '2',
          },
        })
      } catch (error) {
        log.warn('Musterlösungsjob beendet', { jobId: claimed.jobId, error })
        const retry = claimed.attempt < MAX_ATTEMPTS
        await useDatabase()
          .update(aiJobs)
          .set({
            status: retry ? 'wartend' : 'fehlgeschlagen',
            errorMessage: retry
              ? null
              : error instanceof Error
                ? error.message.slice(0, 1000)
                : 'Die KI-Musterlösung konnte nicht erzeugt werden.',
            finishedAt: retry ? null : new Date(),
          })
          .where(and(
            eq(aiJobs.id, claimed.jobId),
            inArray(aiJobs.status, ['laeuft', 'fehlgeschlagen']),
          ))
        if (retry) return
      } finally {
        clearInterval(heartbeat)
      }
    }
  } finally {
    polling = false
  }
}

export function wakeSolutionWorker(): void {
  queueMicrotask(() => void poll())
}

export async function startSolutionWorker(): Promise<void> {
  if (interval) return
  await recoverStaleRuns()
  interval = setInterval(() => void poll(), POLL_MS)
  interval.unref?.()
  wakeSolutionWorker()
}
