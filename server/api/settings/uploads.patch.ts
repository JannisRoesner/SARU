import { getUploadSettings, saveUploadSettings } from '../../services/settings.service'
import { requireAdmin } from '../../utils/auth'
import { uploadSettingsSchema } from '../../utils/schemas'
import { readValidatedBody } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireAdmin(event)
  const patch = await readValidatedBody(event, uploadSettingsSchema)

  await saveUploadSettings(patch, user.id)
  return getUploadSettings()
})
