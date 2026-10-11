import { z } from 'zod'
import { sendeDatei } from '../../../../../services/asset-delivery.service'
import { assertDateiImUmfang } from '../../../../../services/share.service'
import { gastZugriff } from '../../../../../utils/gast'
import { parseOrThrow, readValidatedQuery, uuidSchema } from '../../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const umfang = await gastZugriff(event)
  const assetId = parseOrThrow(uuidSchema, getRouterParam(event, 'assetId'))
  await assertDateiImUmfang(umfang, assetId)
  const { inline } = readValidatedQuery(event, z.object({ inline: z.enum(['0', '1']).default('0') }))
  return sendeDatei(event, assetId, inline === '1')
})
