import { listModels } from '../../services/ai/client'
import { getAiSettings } from '../../services/settings.service'
import { requireAdmin } from '../../utils/auth'
import { checkRateLimit } from '../../utils/rate-limit'
import { aiTestSchema } from '../../utils/schemas'
import { readZodBody } from '../../utils/validation'

/**
 * Verfügbare Modelle für die Auswahllisten. Wie beim Verbindungstest gilt der
 * noch nicht gespeicherte Formularstand; ein leerer Schlüssel wird aus der
 * gespeicherten Konfiguration ergänzt.
 */
export default defineEventHandler(async (event) => {
  const user = await requireAdmin(event)
  const patch = await readZodBody(event, aiTestSchema)

  checkRateLimit(`ki-modelle:${user.id}`, {
    limit: 30,
    windowMs: 60_000,
    message: 'Bitte einen Moment warten, bevor die Modelle erneut geladen werden.',
  })

  const stored = await getAiSettings()
  return listModels({ ...stored, ...patch, apiKey: patch.apiKey || stored.apiKey })
})
