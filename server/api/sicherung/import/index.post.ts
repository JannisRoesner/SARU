import { recordAudit } from '../../../services/audit.service'
import { sicherungAnalysieren, sicherungEntgegennehmen } from '../../../services/sicherung/import.service'
import { requireAdmin } from '../../../utils/auth'
import { invalidInput } from '../../../utils/errors'

/**
 * Nimmt eine Sicherung als rohen Request-Body entgegen (kein Multipart) und
 * schreibt sie direkt auf die Platte – mehrere GB passen nicht in den Speicher.
 * Der Dateiname kommt URL-kodiert im Header `x-dateiname`.
 */
export default defineEventHandler(async (event) => {
  const user = await requireAdmin(event)

  const typ = getRequestHeader(event, 'content-type') ?? ''
  if (typ.startsWith('multipart/') || typ.startsWith('application/json')) {
    throw invalidInput('Bitte die ZIP-Datei direkt als Request-Body senden.')
  }
  let dateiName = 'SARU-Sicherung.zip'
  try {
    dateiName = decodeURIComponent(getRequestHeader(event, 'x-dateiname') ?? '') || dateiName
  } catch {
    // Ungültige Kodierung: Standardnamen verwenden.
  }

  const upload = await sicherungEntgegennehmen(event.node.req, dateiName)
  const analyse = await sicherungAnalysieren({ ...upload, dateiName }, user.id)

  await recordAudit(
    {
      userId: user.id,
      action: 'sicherung.analysiert',
      entityType: 'import',
      entityId: analyse.runId,
      details: { datei: analyse.dateiName, groesse: analyse.dateiGroesse, eintraege: analyse.eintraege.length },
    },
    event,
  )

  setResponseStatus(event, 201)
  return analyse
})
