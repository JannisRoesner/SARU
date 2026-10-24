import { abbildungenKiAbbrechen } from '../../../../services/abbildungen/ki.service'
import { requireMaterialBearbeiten } from '../../../../utils/permissions'
import { parseOrThrow, uuidSchema } from '../../../../utils/validation'

/** Laufende KI-Ergänzung abbrechen; bereits ergänzte Bilder behalten ihre Angaben. */
export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  await requireMaterialBearbeiten(event, id)
  return { abgebrochen: abbildungenKiAbbrechen(id) }
})
