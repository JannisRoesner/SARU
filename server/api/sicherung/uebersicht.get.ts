import { sicherungUebersicht } from '../../services/sicherung/export.service'
import { requireAdmin } from '../../utils/auth'

/** Umfang einer vollständigen Sicherung (Anzahl und Größe), ohne Dateien anzufassen. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return sicherungUebersicht()
})
