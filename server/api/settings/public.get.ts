import {
  getAiSettings,
  getAppearanceSettings,
  getCollaboraSettings,
} from '../../services/settings.service'
import { requireUser } from '../../utils/auth'

/**
 * Die wenigen Einstellungen, die auch Nicht-Administratoren brauchen:
 * Standarddarstellung und ob KI-/Vorschau-Funktionen angeboten werden.
 */
export default defineEventHandler(async (event) => {
  await requireUser(event)

  const [appearance, ai, collabora] = await Promise.all([
    getAppearanceSettings(),
    getAiSettings(),
    getCollaboraSettings(),
  ])

  return {
    ...appearance,
    kiVerfuegbar: ai.enabled && Boolean(ai.chatModel || ai.visionModel),
    kiVisionVerfuegbar: ai.enabled && ai.useVision,
    collaboraVerfuegbar: collabora.enabled && Boolean(collabora.baseUrl.trim()),
  }
})
