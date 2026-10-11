import { deleteAsset } from '../../../services/material.service'
import { requireAssetBearbeiten } from '../../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const assetId = parseOrThrow(uuidSchema, getRouterParam(event, 'assetId'))
  await requireAssetBearbeiten(event, assetId)

  await deleteAsset(assetId)
  return { erfolg: true }
})
