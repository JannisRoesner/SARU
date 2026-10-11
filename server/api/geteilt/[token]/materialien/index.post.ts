import { asc, eq } from 'drizzle-orm'
import { guessMaterialType } from '#shared/utils/material-type-guess'
import { useDatabase } from '../../../../database/client'
import { materialVariants } from '../../../../database/schema'
import { recordAudit } from '../../../../services/audit.service'
import { addFileAsset, addRelation, createMaterial } from '../../../../services/material.service'
import { freigabeHandelnde, requireFreigabeBearbeiten } from '../../../../services/share.service'
import { forbidden, invalidInput } from '../../../../utils/errors'
import { gastZugriff } from '../../../../utils/gast'
import { readMultipartParts } from '../../../../utils/multipart'

/**
 * Neues Material in ein geteiltes Lehrwerk hochladen – je Datei ein Material,
 * zugeordnet zum Lehrwerk. Nur über Bearbeiten-Links auf ein Lehrwerk.
 */
export default defineEventHandler(async (event) => {
  const umfang = await gastZugriff(event)
  requireFreigabeBearbeiten(umfang)
  if (umfang.wurzel.typ !== 'material' || umfang.wurzel.materialType !== 'lehrwerk') {
    throw forbidden('Neues Material lässt sich nur in ein geteiltes Lehrwerk hochladen.')
  }
  const lehrwerkId = umfang.wurzel.id
  const handelnde = await freigabeHandelnde(umfang)

  const parts = await readMultipartParts(event)
  const files = parts?.filter((part) => part.filename && part.data?.length) ?? []
  if (!files.length) throw invalidInput('Es wurde keine Datei übermittelt.')

  const db = useDatabase()
  const erstellt: { id: string; title: string }[] = []
  for (const file of files) {
    const fileName = file.filename!
    const title = fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || fileName
    const materialId = await createMaterial(
      { title, materialType: guessMaterialType(fileName) },
      handelnde.id,
    )
    const [variante] = await db
      .select({ id: materialVariants.id })
      .from(materialVariants)
      .where(eq(materialVariants.materialId, materialId))
      .orderBy(asc(materialVariants.sortOrder))
      .limit(1)
    await addFileAsset(variante!.id, { buffer: Buffer.from(file.data), fileName }, { role: 'haupt' })
    await addRelation(materialId, lehrwerkId, 'gehoert_zu', 'Über Freigabe-Link hochgeladen')
    erstellt.push({ id: materialId, title })
  }

  await recordAudit(
    {
      userId: handelnde.id,
      action: 'material.angelegt',
      entityType: 'material',
      entityId: lehrwerkId,
      details: { anzahl: erstellt.length, ueberFreigabe: umfang.link.id },
    },
    event,
  )
  setResponseStatus(event, 201)
  return { erstellt }
})
