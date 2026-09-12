import { and, asc, eq, lt } from 'drizzle-orm'
import { aiJobs } from '../../../database/schema'
import { useDatabase } from '../../../database/client'
import { createLogger } from '../../../utils/logger'

const log = createLogger('ai:differenzierung-worker')
const POLL_MS = 2_000
const STALE_AFTER_MS = 15 * 60_000

let polling = false
let interval: ReturnType<typeof setInterval> | null = null

async function recoverStaleJobs(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS)
  await useDatabase()
    .update(aiJobs)
    .set({
      status: 'fehlgeschlagen',
      errorMessage: 'Der Hintergrundlauf wurde nach einem Serverabbruch beendet.',
      finishedAt: new Date(),
    })
    .where(and(
      eq(aiJobs.kind, 'differenzierung'),
      eq(aiJobs.status, 'laeuft'),
      lt(aiJobs.createdAt, staleBefore),
    ))
}

async function claimNextJob(): Promise<{ jobId: string } | null> {
  const db = useDatabase()
  const candidates = await db
    .select({ id: aiJobs.id })
    .from(aiJobs)
    .where(and(eq(aiJobs.kind, 'differenzierung'), eq(aiJobs.status, 'wartend')))
    .orderBy(asc(aiJobs.createdAt))
    .limit(4)

  for (const candidate of candidates) {
    const claimed = await db
      .update(aiJobs)
      .set({ status: 'laeuft', errorMessage: null, finishedAt: null })
      .where(and(eq(aiJobs.id, candidate.id), eq(aiJobs.status, 'wartend')))
      .returning({ id: aiJobs.id })
    if (claimed[0]) return { jobId: claimed[0].id }
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
      try {
        const { generateDifferentiation } = await import('./service')
        await generateDifferentiation(claimed.jobId)
      } catch (error) {
        log.warn('Differenzierungsjob beendet', { jobId: claimed.jobId, error })
        await useDatabase()
          .update(aiJobs)
          .set({
            status: 'fehlgeschlagen',
            errorMessage:
              error instanceof Error
                ? error.message.slice(0, 1000)
                : 'Die Differenzierungsfassung konnte nicht erzeugt werden.',
            finishedAt: new Date(),
          })
          .where(and(eq(aiJobs.id, claimed.jobId), eq(aiJobs.status, 'laeuft')))
      }
    }
  } finally {
    polling = false
  }
}

export function wakeDifferentiationWorker(): void {
  queueMicrotask(() => void poll())
}

export async function startDifferentiationWorker(): Promise<void> {
  if (interval) return
  await recoverStaleJobs()
  interval = setInterval(() => void poll(), POLL_MS)
  interval.unref?.()
  wakeDifferentiationWorker()
}
