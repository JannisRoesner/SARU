import { getHermesSettings, saveHermesSettings } from '../../services/settings.service'
import { recordAudit } from '../../services/audit.service'
import { maskSecret } from '../../utils/crypto'
import { requireAdmin } from '../../utils/auth'
import { hermesSettingsSchema } from '../../utils/schemas'
import { readZodBody } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireAdmin(event)
  const patch = await readZodBody(event, hermesSettingsSchema)

  await saveHermesSettings(patch, user.id)
  await recordAudit(
    {
      userId: user.id,
      action: 'einstellungen.hermes_geaendert',
      entityType: 'system',
      details: {
        aktiv: patch.enabled,
        schluesselGeaendert: patch.apiKey !== undefined,
      },
    },
    event,
  )

  const saved = await getHermesSettings()
  return {
    ...saved,
    apiKey: maskSecret(saved.apiKey),
    apiKeyGesetzt: Boolean(saved.apiKey),
  }
})
