import { getAppearanceSettings, saveAppearanceSettings } from '../../services/settings.service'
import { requireAdmin } from '../../utils/auth'
import { appearanceSettingsSchema } from '../../utils/schemas'
import { readValidatedBody } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireAdmin(event)
  const patch = await readValidatedBody(event, appearanceSettingsSchema)

  await saveAppearanceSettings(patch, user.id)
  return getAppearanceSettings()
})
