import { z } from 'zod'
import { setFavorite } from '../../../services/material.service'
import { requireRecht } from '../../../utils/permissions'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireRecht(event, 'anlegen')
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const { isFavorite } = await readZodBody(event, z.object({ isFavorite: z.boolean() }))

  await setFavorite(id, isFavorite)
  return { isFavorite }
})
