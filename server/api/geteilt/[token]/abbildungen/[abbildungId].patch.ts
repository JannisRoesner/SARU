import { recordAudit } from '../../../../services/audit.service'
import { abbildungAktualisieren, abbildungMaterialId } from '../../../../services/abbildungen/abbildung.service'
import { gastAbbildung } from '../../../../services/share-view.service'
import {
  assertMaterialImUmfang,
  freigabeHandelnde,
  requireFreigabeBearbeiten,
} from '../../../../services/share.service'
import { gastZugriff } from '../../../../utils/gast'
import { abbildungPatchSchema } from '../../../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../../utils/validation'

/** Angaben eines Bildes über einen Bearbeiten-Link ändern. */
export default defineEventHandler(async (event) => {
  const umfang = await gastZugriff(event)
  requireFreigabeBearbeiten(umfang)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'abbildungId'))
  const materialId = await abbildungMaterialId(id)
  assertMaterialImUmfang(umfang, materialId)
  const patch = await readZodBody(event, abbildungPatchSchema)
  const handelnde = await freigabeHandelnde(umfang)

  await abbildungAktualisieren(id, patch)
  await recordAudit(
    {
      userId: handelnde.id,
      action: 'abbildung.geaendert',
      entityType: 'material',
      entityId: materialId,
      details: { abbildungId: id, ueberFreigabe: umfang.link.id },
    },
    event,
  )
  return gastAbbildung(umfang, id)
})
