import { getPrivacySettings, savePrivacySettings } from '../../services/settings.service'
import { recordAudit } from '../../services/audit.service'
import { requireAdmin } from '../../utils/auth'
import { privacySettingsSchema } from '../../utils/schemas'
import { readValidatedBody } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireAdmin(event)
  const patch = await readValidatedBody(event, privacySettingsSchema)

  await savePrivacySettings(patch, user.id)
  await recordAudit(
    {
      userId: user.id,
      action: 'einstellungen.datenschutz_geaendert',
      entityType: 'system',
      details: patch,
    },
    event,
  )

  return getPrivacySettings()
})
