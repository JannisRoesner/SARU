import { getMaterialDetail } from '../../../../../repositories/material.repository'
import { sammleLehrwerkZipEintraege, sammleZipEintraege, zipStream } from '../../../../../services/material-zip.service'
import { assertMaterialImUmfang } from '../../../../../services/share.service'
import { gastZugriff } from '../../../../../utils/gast'
import { notFound } from '../../../../../utils/errors'
import { parseOrThrow, uuidSchema } from '../../../../../utils/validation'

/**
 * Alle Dateien eines geteilten Materials und seiner zugeordneten Materialien (inkl. Lösungen) als ZIP.
 * Ein Lehrwerk kommt komplett in Ordnern (Schulbuch, Serviceband, Versuche …).
 */
export default defineEventHandler(async (event) => {
  const umfang = await gastZugriff(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  assertMaterialImUmfang(umfang, id)

  const detail = await getMaterialDetail(id)
  if (!detail) throw notFound('Das Material')

  // Der Umfang des Links ist die Obergrenze: nur Materialien, die er freigibt.
  const eintraege =
    detail.materialType === 'lehrwerk'
      ? await sammleLehrwerkZipEintraege(id, umfang.materialIds)
      : await sammleZipEintraege(id, umfang.materialIds)
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
