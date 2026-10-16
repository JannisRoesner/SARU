import {
  embeddingsNachAnbieterwechselVerwerfen,
  imageEmbeddingsActive,
  materialienNeuIndizieren,
  startEmbeddingJob,
} from '../../services/search/indexer'
import { aiSettingsFuerClient, getAiSettings, saveAiSettings } from '../../services/settings.service'
import { recordAudit } from '../../services/audit.service'
import { requireAdmin } from '../../utils/auth'
import { aiSettingsSchema } from '../../utils/schemas'
import { readZodBody } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireAdmin(event)
  const patch = await readZodBody(event, aiSettingsSchema)

  const vorher = await getAiSettings()
  const bilderVorher = imageEmbeddingsActive(vorher)
  await saveAiSettings(patch, user.id)
  await recordAudit(
    {
      userId: user.id,
      action: 'einstellungen.ki_geaendert',
      entityType: 'system',
      details: {
        provider: patch.provider,
        aktiv: patch.enabled,
        rollen: patch.rollen
          ? Object.fromEntries(Object.entries(patch.rollen).map(([rolle, wert]) => [rolle, wert?.provider]))
          : undefined,
        // Die Schlüssel selbst werden nie protokolliert.
        schluesselGeaendert:
          patch.apiKey !== undefined || Object.values(patch.rollen ?? {}).some((wert) => wert?.apiKey !== undefined),
      },
    },
    event,
  )

  const saved = await getAiSettings()

  const embeddingsVerworfen = await embeddingsNachAnbieterwechselVerwerfen(vorher, saved)

  // Seitenbilder ein- oder ausgeschaltet: Die Materialien bekommen ihre Bildabschnitte
  // über die Warteschlange, die danach selbst die Vektoren nachzieht.
  if (imageEmbeddingsActive(saved) !== bilderVorher) {
    void materialienNeuIndizieren()
  } else {
    // Nach einem Modellwechsel die Vektoren im Hintergrund neu berechnen (ohne Wirkung, wenn nichts aussteht).
    void startEmbeddingJob()
  }

  return { ...aiSettingsFuerClient(saved), embeddingsVerworfen }
})
