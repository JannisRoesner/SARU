import { and, eq } from 'drizzle-orm'
import { aiJobs, aiSolutionRuns } from '../../../database/schema'
import { useDatabase } from '../../../database/client'
import { fileExists, isInlineSafe, readFileStream } from '../../../services/storage.service'
import { requireEditor } from '../../../utils/auth'
import { notFound } from '../../../utils/errors'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const [draft] = await useDatabase()
    .select({
      storageKey: aiSolutionRuns.draftStorageKey,
      fileName: aiSolutionRuns.draftFileName,
      mimeType: aiSolutionRuns.draftMimeType,
    })
    .from(aiSolutionRuns)
    .innerJoin(aiJobs, eq(aiJobs.id, aiSolutionRuns.jobId))
    .where(and(eq(aiSolutionRuns.id, id), eq(aiJobs.userId, user.id)))
    .limit(1)
  if (!draft?.storageKey || !(await fileExists(draft.storageKey))) throw notFound('Die Entwurfsdatei')

  const mimeType = draft.mimeType ?? 'application/octet-stream'
  const inline = isInlineSafe(mimeType)
  setResponseHeader(event, 'content-type', inline ? mimeType : 'application/octet-stream')
  setResponseHeader(
    event,
    'content-disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(draft.fileName ?? 'musterloesung-entwurf.pdf')}`,
  )
  setResponseHeader(event, 'cache-control', 'private, max-age=60')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  return sendStream(event, readFileStream(draft.storageKey))
})

