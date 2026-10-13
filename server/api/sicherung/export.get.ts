import { recordAudit } from '../../services/audit.service'
import { sicherungErstellen } from '../../services/sicherung/export.service'
import { requireAdmin } from '../../utils/auth'
import { createLogger } from '../../utils/logger'

const log = createLogger('sicherung:export')

/** Vollständige Sicherung aller Inhalte als ZIP – gestreamt, auch für sehr große Instanzen. */
export default defineEventHandler(async (event) => {
  const user = await requireAdmin(event)
  const { stream, gesammelt } = await sicherungErstellen(user.email)

  stream.on('error', (error) => log.error('Sicherung abgebrochen', { error }))

  await recordAudit(
    {
      userId: user.id,
      action: 'sicherung.exportiert',
      details: {
        materialien: gesammelt.daten.tabellen.materials.length,
        reihen: gesammelt.daten.tabellen.series.length,
        stunden: gesammelt.daten.tabellen.lessons.length,
        dateien: gesammelt.dateien.length,
        fehlend: gesammelt.fehlend.length,
      },
    },
    event,
  )

  const datum = new Date().toISOString().slice(0, 10)
  setResponseHeader(event, 'content-type', 'application/zip')
  setResponseHeader(event, 'content-disposition', `attachment; filename="SARU-Sicherung-${datum}.zip"`)
  setResponseHeader(event, 'cache-control', 'private, no-store')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  return sendStream(event, stream)
})
