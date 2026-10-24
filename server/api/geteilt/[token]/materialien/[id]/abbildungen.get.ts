import { gastAbbildungen } from '../../../../../services/share-view.service'
import { assertMaterialImUmfang } from '../../../../../services/share.service'
import { gastZugriff } from '../../../../../utils/gast'
import { parseOrThrow, uuidSchema } from '../../../../../utils/validation'

/** Bilder einer geteilten Abbildungssammlung (ohne Anmeldung). */
export default defineEventHandler(async (event) => {
  const umfang = await gastZugriff(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  assertMaterialImUmfang(umfang, id)
  return {
    abbildungen: await gastAbbildungen(umfang, id),
    darfBearbeiten: umfang.link.permission === 'bearbeiten',
  }
})
