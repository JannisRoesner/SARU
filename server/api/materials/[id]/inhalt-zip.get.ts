import { getMaterialDetail } from '../../../repositories/material.repository'
import { sammleZipEintraege, zipStream } from '../../../services/material-zip.service'
import { requireUser } from '../../../utils/auth'
import { notFound } from '../../../utils/errors'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/** Alle Dateien eines Materials und seiner zugeordneten Materialien (inkl. Lösungen) als ZIP. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))

  const detail = await getMaterialDetail(id)
  if (!detail) throw notFound('Das Material')

  const eintraege = await sammleZipEintraege(id)
  if (!eintraege.length) throw notFound('Die Dateien')

  const dateiName = `${detail.title.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim() || 'Material'}.zip`
  setResponseHeader(event, 'content-type', 'application/zip')
  setResponseHeader(
    event,
    'content-disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(dateiName)}`,
  )
  setResponseHeader(event, 'cache-control', 'private, no-store')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  return sendStream(event, zipStream(eintraege))
})
