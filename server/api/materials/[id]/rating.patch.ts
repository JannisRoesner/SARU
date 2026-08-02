import { z } from 'zod'
import { setRating } from '../../../services/material.service'
import { requireEditor } from '../../../utils/auth'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const { rating } = await readZodBody(
    event,
    z.object({ rating: z.coerce.number().int().min(0).max(5).nullable() }),
  )

  await setRating(id, rating)
  return { rating }
})
