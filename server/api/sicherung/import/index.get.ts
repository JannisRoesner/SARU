import { sicherungLaeufe } from '../../../services/sicherung/import.service'
import { requireAdmin } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return sicherungLaeufe()
})
