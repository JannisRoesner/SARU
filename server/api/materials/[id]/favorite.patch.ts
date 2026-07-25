import { z } from 'zod'
import { setFavorite } from '../../../services/material.service'
import { requireEditor } from '../../../utils/auth'
import { parseOrThrow, readValidatedBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const { isFavorite } = await readValidatedBody(event, z.object({ isFavorite: z.boolean() }))

  await setFavorite(id, isFavorite)
  return { isFavorite }
})
