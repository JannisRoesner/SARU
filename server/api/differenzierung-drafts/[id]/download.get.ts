import { getDifferentiationDraftDownload } from '../../../services/ai/differenzierung/service'
import { fileExists, isInlineSafe, readFileStream } from '../../../services/storage.service'
import { requireEditor } from '../../../utils/auth'
import { notFound } from '../../../utils/errors'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const draft = await getDifferentiationDraftDownload(id, user.id)
  if (!(await fileExists(draft.storageKey))) throw notFound('Die Entwurfsdatei')

  const mimeType = draft.mimeType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  const inline = isInlineSafe(mimeType)
  setResponseHeader(event, 'content-type', inline ? mimeType : 'application/octet-stream')
  setResponseHeader(
    event,
    'content-disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(draft.fileName)}`,
  )
  setResponseHeader(event, 'cache-control', 'private, max-age=60')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  return sendStream(event, readFileStream(draft.storageKey))
})
