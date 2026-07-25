import { extractAssetText } from '../../../services/material.service'
import { requireEditor } from '../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/** Stößt die Textextraktion erneut an, etwa nach einem Fehlschlag. */
export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const assetId = parseOrThrow(uuidSchema, getRouterParam(event, 'assetId'))

  await extractAssetText(assetId)
  return { erfolg: true }
})
