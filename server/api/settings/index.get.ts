import {
  getEmbeddingModelWarning,
  resolveEmbeddingModel,
} from '#shared/utils/embeddings'
import {
  aiSettingsFuerClient,
  aiVerbindung,
  getAiSettings,
  getAppearanceSettings,
  getCollaboraSettings,
  getPrivacySettings,
  getUploadSettings,
  PROVIDER_MODEL_HINTS,
} from '../../services/settings.service'
import { EMBEDDING_DIMENSIONS } from '../../database/schema'
import { requireAdmin } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const [ai, uploads, privacy, appearance, collabora] = await Promise.all([
    getAiSettings(),
    getUploadSettings(),
    getPrivacySettings(),
    getAppearanceSettings(),
    getCollaboraSettings(),
  ])

  // Die API-Schlüssel verlassen den Server nie im Klartext.
  const embedding = aiVerbindung(ai, 'embedding')
  const embeddingProvider = embedding.provider
  return {
    ai: {
      ...aiSettingsFuerClient(ai),
      embeddingModelEffektiv: resolveEmbeddingModel(embeddingProvider, ai.embeddingModel),
      embeddingModelWarnung: getEmbeddingModelWarning(embeddingProvider, ai.embeddingModel),
      /** Gespeicherte Embedding-Verbindung – die Oberfläche warnt, wenn das Formular davon abweicht. */
      embeddingVerbindung: { provider: embedding.provider, baseUrl: embedding.baseUrl },
      embeddingDimensionen: EMBEDDING_DIMENSIONS,
    },
    uploads,
    privacy,
    appearance,
    collabora,
    modelHints: PROVIDER_MODEL_HINTS,
  }
})
