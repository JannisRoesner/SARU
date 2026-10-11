import { z } from 'zod'
import { setRating } from '../../../services/material.service'
import { requireRecht } from '../../../utils/permissions'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireRecht(event, 'anlegen')
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const { rating } = await readZodBody(
    event,
    z.object({ rating: z.coerce.number().int().min(0).max(5).nullable() }),
  )

  await setRating(id, rating)
  return { rating }
})
