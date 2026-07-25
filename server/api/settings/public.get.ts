import { getAiSettings, getAppearanceSettings } from '../../services/settings.service'
import { requireUser } from '../../utils/auth'

/**
 * Die wenigen Einstellungen, die auch Nicht-Administratoren brauchen:
 * Standarddarstellung und ob KI-Funktionen überhaupt angeboten werden.
 */
export default defineEventHandler(async (event) => {
  await requireUser(event)

  const [appearance, ai] = await Promise.all([getAppearanceSettings(), getAiSettings()])

  return {
    ...appearance,
    kiVerfuegbar: ai.enabled && Boolean(ai.chatModel),
    kiVisionVerfuegbar: ai.enabled && ai.useVision,
  }
})
