import { z } from 'zod'
import { recordAudit } from '../../../../services/audit.service'
import { updateMaterial } from '../../../../services/material.service'
import {
  assertMaterialImUmfang,
  freigabeHandelnde,
  requireFreigabeBearbeiten,
} from '../../../../services/share.service'
import { gastMaterial } from '../../../../services/share-view.service'
import { gastZugriff } from '../../../../utils/gast'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../../utils/validation'

const schema = z.object({
  title: z.string().trim().min(1, 'Bitte einen Titel angeben.').max(300).optional(),
  description: z.string().max(5000).nullable().optional(),
})

/** Titel und Beschreibung über einen Bearbeiten-Link ändern. */
export default defineEventHandler(async (event) => {
  const umfang = await gastZugriff(event)
  requireFreigabeBearbeiten(umfang)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  assertMaterialImUmfang(umfang, id)
  const input = await readZodBody(event, schema)
  const handelnde = await freigabeHandelnde(umfang)

  await updateMaterial(id, input)
  await recordAudit(
    {
      userId: handelnde.id,
      action: 'material.geaendert',
      entityType: 'material',
      entityId: id,
      details: { ueberFreigabe: umfang.link.id },
    },
    event,
  )
  return gastMaterial(umfang, id)
})
