import {
  getAiSettings,
  getAppearanceSettings,
  getPrivacySettings,
  getUploadSettings,
} from '../../services/settings.service'
import { maskSecret } from '../../utils/crypto'
import { requireAdmin } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const [ai, uploads, privacy, appearance] = await Promise.all([
    getAiSettings(),
    getUploadSettings(),
    getPrivacySettings(),
    getAppearanceSettings(),
  ])

  // Der API-Schlüssel verlässt den Server nie im Klartext.
  return {
    ai: { ...ai, apiKey: maskSecret(ai.apiKey), apiKeyGesetzt: Boolean(ai.apiKey) },
    uploads,
    privacy,
    appearance,
  }
})
