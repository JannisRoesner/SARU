import { getMaterialDetail } from '../../../repositories/material.repository'
import { requireUser } from '../../../utils/auth'
import { notFound } from '../../../utils/errors'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))

  const detail = await getMaterialDetail(id)
  if (!detail) throw notFound('Das Material')
  return detail
})
