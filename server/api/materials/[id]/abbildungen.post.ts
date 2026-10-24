import { recordAudit } from '../../../services/audit.service'
import { abbildungenAusUploadHinzufuegen } from '../../../services/abbildungen/upload'
import { requireMaterialBearbeiten } from '../../../utils/permissions'
import { readMultipartParts } from '../../../utils/multipart'
import { invalidInput } from '../../../utils/errors'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/** Bilder (optional mit `abbildungen.json`) zu einer Abbildungssammlung hinzufügen. */
export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const user = await requireMaterialBearbeiten(event, id)
  const parts = await readMultipartParts(event)
  if (!parts?.length) throw invalidInput('Es wurde keine Datei übermittelt.')

  const ergebnis = await abbildungenAusUploadHinzufuegen(id, parts)
  await recordAudit(
    {
      userId: user.id,
      action: 'abbildungen.hinzugefuegt',
      entityType: 'material',
      entityId: id,
      details: { angelegt: ergebnis.angelegt.length, uebersprungen: ergebnis.uebersprungen.length },
    },
    event,
  )
  setResponseStatus(event, 201)
  return ergebnis
})
