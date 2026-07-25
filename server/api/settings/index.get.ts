import {
  getEmbeddingModelWarning,
  resolveEmbeddingModel,
} from '#shared/utils/embeddings'
import {
  getAiSettings,
  getAppearanceSettings,
  getCollaboraSettings,
  getHermesSettings,
  getPrivacySettings,
  getUploadSettings,
  PROVIDER_MODEL_HINTS,
} from '../../services/settings.service'
import { maskSecret } from '../../utils/crypto'
import { requireAdmin } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const [ai, uploads, privacy, appearance, collabora, hermes] = await Promise.all([
    getAiSettings(),
    getUploadSettings(),
    getPrivacySettings(),
    getAppearanceSettings(),
    getCollaboraSettings(),
    getHermesSettings(),
  ])

  // Der API-Schlüssel verlässt den Server nie im Klartext.
  return {
    ai: {
      ...ai,
      apiKey: maskSecret(ai.apiKey),
      apiKeyGesetzt: Boolean(ai.apiKey),
      embeddingModelEffektiv: resolveEmbeddingModel(ai.provider, ai.embeddingModel),
      embeddingModelWarnung: getEmbeddingModelWarning(ai.provider, ai.embeddingModel),
    },
    uploads,
    privacy,
    appearance,
    collabora,
    hermes: {
      ...hermes,
      apiKey: maskSecret(hermes.apiKey),
      apiKeyGesetzt: Boolean(hermes.apiKey),
    },
    modelHints: PROVIDER_MODEL_HINTS,
  }
})
