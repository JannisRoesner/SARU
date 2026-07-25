import { probeCollaboraDiscovery } from '../../services/collabora.service'
import { getCollaboraSettings } from '../../services/settings.service'
import { requireAdmin } from '../../utils/auth'

/** Kurzer Erreichbarkeitstest für Collabora Discovery (Admin). */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const settings = await getCollaboraSettings()
  const probe = await probeCollaboraDiscovery()
  return {
    enabled: settings.enabled,
    baseUrl: settings.baseUrl,
    wopiHostUrl: settings.wopiHostUrl,
    discoveryOk: probe.ok,
    resolvedBaseUrl: probe.resolvedBaseUrl,
    hinweis: probe.ok
      ? null
      : 'Discovery fehlgeschlagen. Prüfen Sie Protokoll (https vs. http), ob Collabora läuft und ob ein selbstsigniertes Zertifikat blockiert wird.',
  }
})
