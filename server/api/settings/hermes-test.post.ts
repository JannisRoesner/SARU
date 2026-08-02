import { testHermesConnection } from '../../services/ai/hermes'
import { getHermesSettings, type HermesSettings } from '../../services/settings.service'
import { requireAdmin } from '../../utils/auth'
import { hermesSettingsSchema } from '../../utils/schemas'
import { readZodBody } from '../../utils/validation'

/** Prüft die Erreichbarkeit des konfigurierten Hermes-Agent-Containers. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const patch = await readZodBody(event, hermesSettingsSchema)
  const stored = await getHermesSettings()

  const candidate: HermesSettings = {
    ...stored,
    ...patch,
    apiKey:
      patch.apiKey === undefined
        ? stored.apiKey
        : patch.apiKey
          ? patch.apiKey
          : '',
  }

  return testHermesConnection(candidate)
})
