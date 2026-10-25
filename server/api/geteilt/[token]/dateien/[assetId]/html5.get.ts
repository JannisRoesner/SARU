import { html5Startadresse } from '../../../../../services/html5-paket.service'
import { assertDateiImUmfang } from '../../../../../services/share.service'
import { gastZugriff } from '../../../../../utils/gast'
import { parseOrThrow, uuidSchema } from '../../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const umfang = await gastZugriff(event)
  const assetId = parseOrThrow(uuidSchema, getRouterParam(event, 'assetId'))
  await assertDateiImUmfang(umfang, assetId)
  return html5Startadresse(assetId)
})
