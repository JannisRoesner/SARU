import { darfObjektLoeschen } from '#shared/utils/rechte'
import { listLehrwerkInhaltBesitzer } from '../../../repositories/material.repository'
import { deleteMaterial } from '../../../services/material.service'
import { recordAudit } from '../../../services/audit.service'
import { requireMaterialLoeschen } from '../../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/**
 * Löscht ein Material. Mit `?mitInhalt=1` gehen bei einem Lehrwerk auch die
 * zugeordneten Materialien mit – aber nur die, die die Person löschen darf;
 * die übrigen bleiben erhalten und verlieren lediglich die Zuordnung.
 */
export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const user = await requireMaterialLoeschen(event, id)
  const mitInhalt = ['1', 'true'].includes(String(getQuery(event).mitInhalt ?? ''))

  const inhalt = mitInhalt ? await listLehrwerkInhaltBesitzer(id) : []
  const loeschbar = inhalt.filter((m) => darfObjektLoeschen(user, m.ownerId))

  await deleteMaterial(id)
  await recordAudit(
    { userId: user.id, action: 'material.geloescht', entityType: 'material', entityId: id },
    event,
  )

  for (const material of loeschbar) {
    await deleteMaterial(material.id)
    await recordAudit(
      {
        userId: user.id,
        action: 'material.geloescht',
        entityType: 'material',
        entityId: material.id,
        details: { mitLehrwerk: id },
      },
      event,
    )
  }

  return {
    erfolg: true,
    inhaltGeloescht: loeschbar.length,
    inhaltBehalten: inhalt.length - loeschbar.length,
  }
})
