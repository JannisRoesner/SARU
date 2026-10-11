import { asc, eq } from 'drizzle-orm'
import { useDatabase } from '../../../../../database/client'
import { materialAssets, materialVariants } from '../../../../../database/schema'
import { recordAudit } from '../../../../../services/audit.service'
import { addFileAsset } from '../../../../../services/material.service'
import {
  assertMaterialImUmfang,
  freigabeHandelnde,
  requireFreigabeBearbeiten,
} from '../../../../../services/share.service'
import { invalidInput, notFound } from '../../../../../utils/errors'
import { gastZugriff } from '../../../../../utils/gast'
import { readMultipartParts } from '../../../../../utils/multipart'
import { parseOrThrow, uuidSchema } from '../../../../../utils/validation'

/** Dateien zu einem Material hinzufügen (Standardfassung) – nur über Bearbeiten-Links. */
export default defineEventHandler(async (event) => {
  const umfang = await gastZugriff(event)
  requireFreigabeBearbeiten(umfang)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  assertMaterialImUmfang(umfang, id)
  const handelnde = await freigabeHandelnde(umfang)

  const db = useDatabase()
  const [variante] = await db
    .select({ id: materialVariants.id })
    .from(materialVariants)
    .where(eq(materialVariants.materialId, id))
    .orderBy(asc(materialVariants.sortOrder))
    .limit(1)
  if (!variante) throw notFound('Die Fassung')
  const vorhanden = await db
    .select({ id: materialAssets.id })
    .from(materialAssets)
    .where(eq(materialAssets.variantId, variante.id))
    .limit(1)

  const parts = await readMultipartParts(event)
  const files = parts?.filter((part) => part.filename && part.data?.length) ?? []
  if (!files.length) throw invalidInput('Es wurde keine Datei übermittelt.')

  const erstellt: string[] = []
  for (const [index, file] of files.entries()) {
    await addFileAsset(
      variante.id,
      { buffer: Buffer.from(file.data), fileName: file.filename! },
      { role: vorhanden.length || index > 0 ? 'anhang' : 'haupt' },
    )
    erstellt.push(file.filename!)
  }

  await recordAudit(
    {
      userId: handelnde.id,
      action: 'datei.hochgeladen',
      entityType: 'variante',
      entityId: variante.id,
      details: { anzahl: erstellt.length, ueberFreigabe: umfang.link.id },
    },
    event,
  )
  setResponseStatus(event, 201)
  return { erstellt }
})
