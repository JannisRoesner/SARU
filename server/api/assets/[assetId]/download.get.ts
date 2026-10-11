import { z } from 'zod'
import { sendeDatei } from '../../../services/asset-delivery.service'
import { requireUser } from '../../../utils/auth'
import { parseOrThrow, readValidatedQuery, uuidSchema } from '../../../utils/validation'

/** Liefert eine hinterlegte Datei aus (Download oder – für sichere Typen – inline). */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const assetId = parseOrThrow(uuidSchema, getRouterParam(event, 'assetId'))
  const { inline } = readValidatedQuery(
    event,
    z.object({ inline: z.enum(['0', '1']).default('0') }),
  )
  return sendeDatei(event, assetId, inline === '1')
})
