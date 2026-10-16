import { listModels } from '../../services/ai/client'
import { aiSettingsFuerVerbindungstest, aiSettingsMitEntwurf, getAiSettings } from '../../services/settings.service'
import { requireAdmin } from '../../utils/auth'
import { checkRateLimit } from '../../utils/rate-limit'
import { aiTestSchema } from '../../utils/schemas'
import { readZodBody } from '../../utils/validation'

/**
 * Verfügbare Modelle für die Auswahllisten – mit `rolle` vom Anbieter dieser
 * Aufgabe. Wie beim Verbindungstest gilt der noch nicht gespeicherte
 * Formularstand; leere Schlüssel werden aus der gespeicherten Konfiguration ergänzt.
 */
export default defineEventHandler(async (event) => {
  const user = await requireAdmin(event)
  const { rolle, ...patch } = await readZodBody(event, aiTestSchema)

  checkRateLimit(`ki-modelle:${user.id}`, {
    limit: 30,
    windowMs: 60_000,
    message: 'Bitte einen Moment warten, bevor die Modelle erneut geladen werden.',
  })

  const settings = aiSettingsMitEntwurf(await getAiSettings(), patch)
  return listModels(rolle ? aiSettingsFuerVerbindungstest(settings, rolle) : settings)
})
