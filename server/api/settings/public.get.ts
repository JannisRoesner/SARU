import {
  getAiSettings,
  getAppearanceSettings,
  getCollaboraSettings,
  getHermesSettings,
} from '../../services/settings.service'
import { requireUser } from '../../utils/auth'

/**
 * Die wenigen Einstellungen, die auch Nicht-Administratoren brauchen:
 * Standarddarstellung und ob KI-/Vorschau-Funktionen angeboten werden.
 */
export default defineEventHandler(async (event) => {
  await requireUser(event)

  const [appearance, ai, collabora, hermes] = await Promise.all([
    getAppearanceSettings(),
    getAiSettings(),
    getCollaboraSettings(),
    getHermesSettings(),
  ])

  return {
    ...appearance,
    kiVerfuegbar:
      (ai.enabled && Boolean(ai.chatModel || ai.visionModel)) ||
      (hermes.enabled && Boolean(hermes.baseUrl.trim())),
    kiVisionVerfuegbar: ai.enabled && ai.useVision,
    collaboraVerfuegbar: collabora.enabled && Boolean(collabora.baseUrl.trim()),
    hermesVerfuegbar: hermes.enabled && Boolean(hermes.baseUrl.trim()),
  }
})
