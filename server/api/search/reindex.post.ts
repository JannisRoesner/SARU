import { reindexAll } from '../../services/search/indexer'
import { recordAudit } from '../../services/audit.service'
import { requireAdmin } from '../../utils/auth'

/** Baut den Suchindex vollständig neu auf – nötig nach Modellwechseln. */
export default defineEventHandler(async (event) => {
  const user = await requireAdmin(event)

  const result = await reindexAll()
  await recordAudit(
    { userId: user.id, action: 'suchindex.neu_aufgebaut', entityType: 'system', details: result },
    event,
  )

  return result
})
