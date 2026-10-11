import { extractAssetText } from '../../../services/material.service'
import { requireAssetBearbeiten } from '../../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/** Stößt die Textextraktion erneut an, etwa nach einem Fehlschlag. */
export default defineEventHandler(async (event) => {
  const assetId = parseOrThrow(uuidSchema, getRouterParam(event, 'assetId'))
  await requireAssetBearbeiten(event, assetId)

  await extractAssetText(assetId)
  return { erfolg: true }
})
