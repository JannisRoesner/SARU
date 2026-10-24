import { recordAudit } from '../../services/audit.service'
import {
  abbildungAktualisieren,
  abbildungMaterialId,
  getAbbildung,
} from '../../services/abbildungen/abbildung.service'
import { requireMaterialBearbeiten } from '../../utils/permissions'
import { abbildungPatchSchema } from '../../utils/schemas'
import { parseOrThrow, readZodBody, uuidSchema } from '../../utils/validation'

/** Angaben eines Bildes ändern (Titel, Beschreibung, Fundstelle, Schlagwörter, Variante …). */
export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const materialId = await abbildungMaterialId(id)
  const user = await requireMaterialBearbeiten(event, materialId)
  const patch = await readZodBody(event, abbildungPatchSchema)
  await abbildungAktualisieren(id, patch)
  await recordAudit(
    { userId: user.id, action: 'abbildung.geaendert', entityType: 'material', entityId: materialId, details: { abbildungId: id } },
    event,
  )
  return getAbbildung(id)
})
