import { z } from 'zod'
import { recordAudit } from '../../services/audit.service'
import { createShare } from '../../services/share.service'
import { requireUser } from '../../utils/auth'
import { readZodBody, uuidSchema } from '../../utils/validation'

const schema = z.object({
  entityType: z.enum(['material', 'reihe']),
  entityId: uuidSchema,
  permission: z.enum(['ansehen', 'bearbeiten']).default('ansehen'),
  label: z.string().trim().max(120).nullish(),
  /** Gültigkeit in Tagen; leer = unbegrenzt. */
  ablaufTage: z.number().int().min(1).max(3650).nullish(),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const input = await readZodBody(event, schema)
  const eintrag = await createShare(input, user)
  await recordAudit(
    {
      userId: user.id,
      action: 'freigabe.erstellt',
      entityType: input.entityType,
      entityId: input.entityId,
      details: { freigabe: eintrag.id, recht: input.permission, ablaufTage: input.ablaufTage ?? null },
    },
    event,
  )
  setResponseStatus(event, 201)
  return eintrag
})
