import { getAiSettings, saveAiSettings } from '../../services/settings.service'
import { recordAudit } from '../../services/audit.service'
import { maskSecret } from '../../utils/crypto'
import { requireAdmin } from '../../utils/auth'
import { aiSettingsSchema } from '../../utils/schemas'
import { readValidatedBody } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireAdmin(event)
  const patch = await readValidatedBody(event, aiSettingsSchema)

  await saveAiSettings(patch, user.id)
  await recordAudit(
    {
      userId: user.id,
      action: 'einstellungen.ki_geaendert',
      entityType: 'system',
      details: {
        provider: patch.provider,
        aktiv: patch.enabled,
        // Der Schlüssel selbst wird nie protokolliert.
        schluesselGeaendert: patch.apiKey !== undefined,
      },
    },
    event,
  )

  const saved = await getAiSettings()
  return { ...saved, apiKey: maskSecret(saved.apiKey), apiKeyGesetzt: Boolean(saved.apiKey) }
})
