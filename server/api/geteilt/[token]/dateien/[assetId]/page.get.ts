import { getQuery } from 'h3'
import { sendeSeite } from '../../../../../services/asset-delivery.service'
import { assertDateiImUmfang } from '../../../../../services/share.service'
import { gastZugriff } from '../../../../../utils/gast'
import { parseOrThrow, uuidSchema } from '../../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const umfang = await gastZugriff(event)
  const assetId = parseOrThrow(uuidSchema, getRouterParam(event, 'assetId'))
  await assertDateiImUmfang(umfang, assetId)
  const query = getQuery(event)
  return sendeSeite(event, assetId, query.page, query.scale)
})
