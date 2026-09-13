import { asc, desc, eq } from 'drizzle-orm'
import { useDatabase } from '../../../database/client'
import { materialAssets, materialVariants } from '../../../database/schema'
import { requireUser } from '../../../utils/auth'
import { notFound } from '../../../utils/errors'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/** Leitet auf die Hauptdatei oder den Hauptlink des Materials weiter. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))

  const [asset] = await useDatabase()
    .select({
      id: materialAssets.id,
      kind: materialAssets.kind,
      url: materialAssets.url,
    })
    .from(materialAssets)
    .innerJoin(materialVariants, eq(materialAssets.variantId, materialVariants.id))
    .where(eq(materialVariants.materialId, id))
    .orderBy(
      desc(materialVariants.isDefault),
      asc(materialVariants.sortOrder),
      asc(materialAssets.role),
      asc(materialAssets.sortOrder),
    )
    .limit(1)

  if (!asset) throw notFound('Die Datei')
  if (asset.kind === 'link') {
    if (!asset.url) throw notFound('Die Datei')
    return sendRedirect(event, asset.url)
  }

  return sendRedirect(event, `/api/assets/${asset.id}/download`)
})
