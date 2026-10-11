import { getAssetPreviewInfoFuerZugang } from '../../../../../services/preview.service'
import { assertDateiImUmfang, freigabeHandelnde } from '../../../../../services/share.service'
import { notFound } from '../../../../../utils/errors'
import { gastDateiBasis, gastZugriff } from '../../../../../utils/gast'
import { parseOrThrow, uuidSchema } from '../../../../../utils/validation'

/** Vorschau über einen Link; Office-Bearbeitung nur bei Bearbeiten-Links und ausdrücklicher Anforderung. */
export default defineEventHandler(async (event) => {
  const umfang = await gastZugriff(event)
  const assetId = parseOrThrow(uuidSchema, getRouterParam(event, 'assetId'))
  await assertDateiImUmfang(umfang, assetId)
  const handelnde = await freigabeHandelnde(umfang)
  const darfSchreiben = umfang.link.permission === 'bearbeiten'
  const bearbeiten = ['1', 'true'].includes(String(getQuery(event).bearbeiten ?? ''))

  const info = await getAssetPreviewInfoFuerZugang(
    assetId,
    { userId: handelnde.id, userName: 'Gast über Freigabe-Link', darfSchreiben },
    getRequestURL(event).origin,
    { bearbeiten, dateiBasis: gastDateiBasis(event) },
  )
  if (!info) throw notFound('Die Datei')
  return info
})
