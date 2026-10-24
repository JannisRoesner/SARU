import { darfObjektBearbeiten } from '#shared/utils/rechte'
import { getMaterialDetail } from '../../../repositories/material.repository'
import { abbildungenOhneAngaben, listAbbildungen } from '../../../services/abbildungen/abbildung.service'
import { abbildungenKiFortschritt, abbildungenKiVerfuegbar } from '../../../services/abbildungen/ki.service'
import { getAiSettings } from '../../../services/settings.service'
import { requireUser } from '../../../utils/auth'
import { notFound } from '../../../utils/errors'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/** Alle Bilder einer Abbildungssammlung samt Angaben und Stand der KI-Ergänzung. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const material = await getMaterialDetail(id)
  if (!material) throw notFound('Das Material')

  const [abbildungen, ohneAngaben, settings] = await Promise.all([
    listAbbildungen(id),
    abbildungenOhneAngaben(id),
    getAiSettings(),
  ])
  return {
    abbildungen,
    darfBearbeiten: darfObjektBearbeiten(user, material.ownerId),
    ki: {
      verfuegbar: abbildungenKiVerfuegbar(settings),
      ohneAngaben,
      fortschritt: abbildungenKiFortschritt(id),
    },
  }
})
