import { recordAudit } from '../../services/audit.service'
import { abbildungLoeschen, abbildungMaterialId } from '../../services/abbildungen/abbildung.service'
import { requireMaterialBearbeiten } from '../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../utils/validation'

/** Bild samt Datei aus der Sammlung entfernen. */
export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const materialId = await abbildungMaterialId(id)
  const user = await requireMaterialBearbeiten(event, materialId)
  await abbildungLoeschen(id)
  await recordAudit(
    { userId: user.id, action: 'abbildung.geloescht', entityType: 'material', entityId: materialId, details: { abbildungId: id } },
    event,
  )
  return { erfolg: true }
})
