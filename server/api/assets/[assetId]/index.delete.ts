import { deleteAsset } from '../../../services/material.service'
import { requireEditor } from '../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const assetId = parseOrThrow(uuidSchema, getRouterParam(event, 'assetId'))

  await deleteAsset(assetId)
  return { erfolg: true }
})
