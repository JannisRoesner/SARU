import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDatabase } from '../../../database/client'
import { materialAssets } from '../../../database/schema'
import { fileExists, isInlineSafe, readFileStream } from '../../../services/storage.service'
import { requireUser } from '../../../utils/auth'
import { notFound } from '../../../utils/errors'
import { parseOrThrow, readValidatedQuery, uuidSchema } from '../../../utils/validation'

/**
 * Liefert eine hinterlegte Datei aus. Der Pfad wird ausschließlich aus dem
 * Datenbankeintrag abgeleitet, nie aus der Anfrage – so ist kein Ausbruch aus
 * dem Upload-Verzeichnis möglich.
 */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const assetId = parseOrThrow(uuidSchema, getRouterParam(event, 'assetId'))
  const { inline } = readValidatedQuery(
    event,
    z.object({ inline: z.enum(['0', '1']).default('0') }),
  )

  const [asset] = await useDatabase()
    .select()
    .from(materialAssets)
    .where(eq(materialAssets.id, assetId))
    .limit(1)

  if (!asset || asset.kind !== 'datei' || !asset.storageKey) throw notFound('Die Datei')
  if (!(await fileExists(asset.storageKey))) throw notFound('Die Datei')

  // Nur unkritische Typen dürfen im Browser gerendert werden; alles andere
  // wird zum Download gezwungen, damit kein HTML/SVG im Kontext der App läuft.
  const showInline = inline === '1' && isInlineSafe(asset.mimeType)
  const fileName = asset.fileName ?? 'datei'

  setResponseHeader(event, 'content-type', showInline ? asset.mimeType! : 'application/octet-stream')
  setResponseHeader(
    event,
    'content-disposition',
    `${showInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  )
  if (asset.sizeBytes) setResponseHeader(event, 'content-length', asset.sizeBytes)
  setResponseHeader(event, 'cache-control', 'private, max-age=300')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  // Bei Inline-Anzeige kein `sandbox`: sonst blockiert der Browser die PDF-/Bildvorschau im iframe.
  if (!showInline) {
    setResponseHeader(event, 'content-security-policy', "default-src 'none'; object-src 'none'; sandbox")
  } else {
    setResponseHeader(event, 'content-security-policy', "default-src 'none'; object-src 'self'; frame-ancestors 'self'")
  }

  return sendStream(event, readFileStream(asset.storageKey))
})
