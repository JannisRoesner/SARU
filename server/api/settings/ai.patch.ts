import {
  imageEmbeddingsActive,
  materialienNeuIndizieren,
  startEmbeddingJob,
} from '../../services/search/indexer'
import { getAiSettings, saveAiSettings } from '../../services/settings.service'
import { recordAudit } from '../../services/audit.service'
import { maskSecret } from '../../utils/crypto'
import { requireAdmin } from '../../utils/auth'
import { aiSettingsSchema } from '../../utils/schemas'
import { readZodBody } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireAdmin(event)
  const patch = await readZodBody(event, aiSettingsSchema)

  const bilderVorher = imageEmbeddingsActive(await getAiSettings())
  await saveAiSettings(patch, user.id)
  await recordAudit(
    {
      userId: user.id,
      action: 'einstellungen.ki_geaendert',
      entityType: 'system',
      details: {
        provider: patch.provider,
        aktiv: patch.enabled,
        // Der Schlüssel selbst wird nie protokolliert.
        schluesselGeaendert: patch.apiKey !== undefined,
      },
    },
    event,
  )

  const saved = await getAiSettings()

  // Seitenbilder ein- oder ausgeschaltet: Die Materialien bekommen ihre Bildabschnitte
  // über die Warteschlange, die danach selbst die Vektoren nachzieht.
  if (imageEmbeddingsActive(saved) !== bilderVorher) {
    void materialienNeuIndizieren()
  } else {
    // Nach einem Modellwechsel die Vektoren im Hintergrund neu berechnen (ohne Wirkung, wenn nichts aussteht).
    void startEmbeddingJob()
  }

  return { ...saved, apiKey: maskSecret(saved.apiKey), apiKeyGesetzt: Boolean(saved.apiKey) }
})
