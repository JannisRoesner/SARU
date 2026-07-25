import { getCollaboraSettings, saveCollaboraSettings } from '../../services/settings.service'
import { clearCollaboraDiscoveryCache } from '../../services/collabora.service'
import { requireAdmin } from '../../utils/auth'
import { collaboraSettingsSchema } from '../../utils/schemas'
import { readValidatedBody } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireAdmin(event)
  const patch = await readValidatedBody(event, collaboraSettingsSchema)
  await saveCollaboraSettings(patch, user.id)
  clearCollaboraDiscoveryCache()
  return getCollaboraSettings()
})
