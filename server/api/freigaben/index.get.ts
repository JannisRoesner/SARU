import { z } from 'zod'
import { assertDarfTeilen, listShares } from '../../services/share.service'
import { requireUser } from '../../utils/auth'
import { readValidatedQuery, uuidSchema } from '../../utils/validation'

/** Aktive Freigabe-Links eines Materials/Lehrwerks oder einer Reihe. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { entityType, entityId } = readValidatedQuery(
    event,
    z.object({ entityType: z.enum(['material', 'reihe']), entityId: uuidSchema }),
  )
  // Die Links enthalten den Zugangsschlüssel – nur wer teilen darf, sieht sie.
  await assertDarfTeilen(user, entityType, entityId)
  return listShares(entityType, entityId)
})
