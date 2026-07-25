import { readMultipartFormData } from 'h3'
import { addFileAsset } from '../../../services/material.service'
import { recordAudit } from '../../../services/audit.service'
import { requireEditor } from '../../../utils/auth'
import { invalidInput } from '../../../utils/errors'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const variantId = parseOrThrow(uuidSchema, getRouterParam(event, 'variantId'))

  const parts = await readMultipartFormData(event)
  const files = parts?.filter((part) => part.filename && part.data?.length) ?? []
  if (!files.length) throw invalidInput('Es wurde keine Datei übermittelt.')

  const roleField = parts?.find((p) => p.name === 'role' && !p.filename)?.data.toString()
  const role = roleField === 'anhang' ? 'anhang' : 'haupt'

  // Jede Datei einzeln behandeln, damit eine abgelehnte Datei die übrigen
  // nicht verhindert. Die Prüfung von Typ und Größe passiert in storeFile.
  const created: { id: string; fileName: string }[] = []
  const rejected: { fileName: string; grund: string }[] = []

  for (const file of files) {
    try {
      const id = await addFileAsset(
        variantId,
        { buffer: Buffer.from(file.data), fileName: file.filename! },
        { role },
      )
      created.push({ id, fileName: file.filename! })
    } catch (error) {
      rejected.push({
        fileName: file.filename!,
        grund:
          error && typeof error === 'object' && 'statusMessage' in error
            ? String(error.statusMessage)
            : 'Die Datei konnte nicht gespeichert werden.',
      })
    }
  }

  if (!created.length) {
    throw invalidInput(
      rejected[0]?.grund ?? 'Keine der Dateien konnte gespeichert werden.',
      { dateien: rejected.map((r) => `${r.fileName}: ${r.grund}`) },
    )
  }

  await recordAudit(
    {
      userId: user.id,
      action: 'datei.hochgeladen',
      entityType: 'variante',
      entityId: variantId,
      details: { anzahl: created.length },
    },
    event,
  )

  setResponseStatus(event, 201)
  return { erstellt: created, abgelehnt: rejected }
})
