import { markMaterialUsed } from '../../../services/material.service'
import { requireUser } from '../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/** Hält fest, wann ein Material zuletzt geöffnet wurde – Basis der Sortierung "zuletzt verwendet". */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))

  await markMaterialUsed([id])
  return { erfolg: true }
})
