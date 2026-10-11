import { z } from 'zod'
import { getMaterialDetail } from '../../../repositories/material.repository'
import { markSolutionReviewed } from '../../../services/ai/solutions'
import { requireMaterialBearbeiten } from '../../../utils/permissions'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

/** Bestätigt, dass eine KI-Musterlösung fachlich geprüft wurde. */
export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const user = await requireMaterialBearbeiten(event, id)
  const { reviewed } = await readZodBody(event, z.object({ reviewed: z.boolean() }))

  await markSolutionReviewed(id, user.id, reviewed)
  return getMaterialDetail(id)
})
