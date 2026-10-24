import { recordAudit } from '../../../../../services/audit.service'
import { abbildungenAusUploadHinzufuegen } from '../../../../../services/abbildungen/upload'
import {
  assertMaterialImUmfang,
  freigabeHandelnde,
  requireFreigabeBearbeiten,
} from '../../../../../services/share.service'
import { invalidInput } from '../../../../../utils/errors'
import { gastZugriff } from '../../../../../utils/gast'
import { readMultipartParts } from '../../../../../utils/multipart'
import { parseOrThrow, uuidSchema } from '../../../../../utils/validation'

/** Bilder zu einer geteilten Abbildungssammlung hinzufügen – nur über Bearbeiten-Links. */
export default defineEventHandler(async (event) => {
  const umfang = await gastZugriff(event)
  requireFreigabeBearbeiten(umfang)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  assertMaterialImUmfang(umfang, id)
  const handelnde = await freigabeHandelnde(umfang)

  const parts = await readMultipartParts(event)
  if (!parts?.length) throw invalidInput('Es wurde keine Datei übermittelt.')
  const ergebnis = await abbildungenAusUploadHinzufuegen(id, parts)

  await recordAudit(
    {
      userId: handelnde.id,
      action: 'abbildungen.hinzugefuegt',
      entityType: 'material',
      entityId: id,
      details: { angelegt: ergebnis.angelegt.length, ueberFreigabe: umfang.link.id },
    },
    event,
  )
  setResponseStatus(event, 201)
  return ergebnis
})
