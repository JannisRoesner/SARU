import { testConnection } from '../../services/ai/client'
import { aiSettingsMitEntwurf, getAiSettings } from '../../services/settings.service'
import { requireAdmin } from '../../utils/auth'
import { checkRateLimit } from '../../utils/rate-limit'
import { aiTestSchema } from '../../utils/schemas'
import { readZodBody } from '../../utils/validation'

/**
 * Prüft die Verbindung zum konfigurierten Anbieter – mit `rolle` die Verbindung
 * der jeweiligen Aufgabe. Nicht übermittelte Felder – insbesondere leere
 * Schlüssel – werden aus der gespeicherten Konfiguration ergänzt, damit man
 * ohne erneute Eingabe testen kann.
 */
export default defineEventHandler(async (event) => {
  const user = await requireAdmin(event)
  const { rolle, ...patch } = await readZodBody(event, aiTestSchema)

  checkRateLimit(`ki-test:${user.id}`, {
    limit: 10,
    windowMs: 60_000,
    message: 'Bitte einen Moment warten, bevor die Verbindung erneut geprüft wird.',
  })

  return testConnection(aiSettingsMitEntwurf(await getAiSettings(), patch), rolle)
})
