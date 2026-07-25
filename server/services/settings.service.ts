import { eq } from 'drizzle-orm'
import { OLLAMA_EMBEDDING_MODEL } from '#shared/utils/embeddings'
import { useDatabase } from '../database/client'
import { appSettings } from '../database/schema'
import { decryptSecret, encryptSecret, maskSecret } from '../utils/crypto'
import { createLogger } from '../utils/logger'

const log = createLogger('settings')

export const SETTING_KEYS = {
  ai: 'ki.konfiguration',
  uploads: 'dateien.regeln',
  privacy: 'datenschutz',
  appearance: 'darstellung.standard',
  collabora: 'vorschau.collabora',
  hermes: 'ki.hermes',
} as const

export type AiProviderId = 'openai' | 'ollama' | 'openrouter'

export interface AiSettings {
  enabled: boolean
  provider: AiProviderId
  /** Leer lassen, um die Standard-URL des Anbieters zu verwenden. */
  baseUrl: string
  /** Im Klartext nur im Speicher; in der Datenbank liegt der Wert verschlüsselt. */
  apiKey: string
  chatModel: string
  /** Optionales, gesondertes Modell für Bild-/PDF-Eingaben. */
  visionModel: string
  /** Dokumente zusätzlich als Bild bzw. PDF an das Modell übergeben. */
  useVision: boolean
  embeddingsEnabled: boolean
  embeddingModel: string
  temperature: number
  maxOutputTokens: number
  timeoutMs: number
  /** Von OpenRouter für die Aufruferkennung ausgewertet. */
  refererUrl: string
  appTitle: string
}

export const DEFAULT_BASE_URLS: Record<AiProviderId, string> = {
  openai: 'https://api.openai.com/v1',
  ollama: 'http://localhost:11434/v1',
  openrouter: 'https://openrouter.ai/api/v1',
}

/** Empfohlene Modellnamen für die Einstellungs-UI (Platzhalter / Schnellwahl). */
export const PROVIDER_MODEL_HINTS: Record<
  AiProviderId,
  { chatModel: string; visionModel: string; embeddingModel: string; useVision: boolean }
> = {
  openai: {
    chatModel: 'gpt-4o-mini',
    visionModel: 'gpt-4o-mini',
    embeddingModel: 'text-embedding-3-small',
    useVision: true,
  },
  // Multimodale lokale Modelle: Vision ist der Hauptpfad für Arbeitsblätter/PDFs.
  ollama: {
    chatModel: 'gemma4:e4b-it-qat',
    visionModel: 'gemma4:e4b-it-qat',
    embeddingModel: OLLAMA_EMBEDDING_MODEL,
    useVision: true,
  },
  openrouter: {
    chatModel: 'openai/gpt-4o-mini',
    visionModel: 'openai/gpt-4o-mini',
    embeddingModel: 'openai/text-embedding-3-small',
    useVision: true,
  },
}

export const defaultAiSettings: AiSettings = {
  enabled: false,
  provider: 'ollama',
  baseUrl: '',
  apiKey: '',
  chatModel: PROVIDER_MODEL_HINTS.ollama.chatModel,
  visionModel: PROVIDER_MODEL_HINTS.ollama.visionModel,
  useVision: true,
  embeddingsEnabled: false,
  embeddingModel: PROVIDER_MODEL_HINTS.ollama.embeddingModel,
  temperature: 0.2,
  maxOutputTokens: 4000,
  timeoutMs: 180_000,
  refererUrl: '',
  appTitle: 'SARU',
}

export interface UploadSettings {
  maxBytes: number
  /** Exportarchive dürfen größer sein als einzelne Materialdateien. */
  maxImportBytes: number
  /** Leere Liste bedeutet: Standardliste aus `files.ts` verwenden. */
  allowedExtensions: string[]
  scanArchives: boolean
}

export const defaultUploadSettings: UploadSettings = {
  maxBytes: Number(process.env.NUXT_MAX_UPLOAD_BYTES ?? 104_857_600),
  maxImportBytes: Number(process.env.NUXT_MAX_IMPORT_BYTES ?? 536_870_912),
  allowedExtensions: [],
  scanArchives: true,
}

export interface PrivacySettings {
  /** Aufbewahrungsdauer für Zugriffsprotokolle in Tagen (0 = unbegrenzt). */
  auditRetentionDays: number
  /** Aufbewahrungsdauer für KI-Protokolle in Tagen. */
  aiJobRetentionDays: number
  /** Prompt-Inhalte im KI-Protokoll speichern. */
  storeAiPrompts: boolean
  searchHistoryRetentionDays: number
}

export const defaultPrivacySettings: PrivacySettings = {
  auditRetentionDays: 365,
  aiJobRetentionDays: 90,
  storeAiPrompts: true,
  searchHistoryRetentionDays: 90,
}

export interface AppearanceSettings {
  defaultTheme: 'hell' | 'dunkel' | 'system'
  defaultPalette: string
  instanceName: string
}

export const defaultAppearanceSettings: AppearanceSettings = {
  defaultTheme: 'system',
  defaultPalette: 'indigo',
  instanceName: 'SARU',
}

async function readRaw<T>(key: string): Promise<Partial<T> | null> {
  const rows = await useDatabase()
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1)
  return (rows[0]?.value as Partial<T> | undefined) ?? null
}

async function writeRaw(key: string, value: unknown, userId?: string): Promise<void> {
  await useDatabase()
    .insert(appSettings)
    .values({ key, value, updatedBy: userId ?? null })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date(), updatedBy: userId ?? null },
    })
}

/** Liefert die KI-Konfiguration inklusive entschlüsseltem Schlüssel (nur serverseitig verwenden!). */
export async function getAiSettings(): Promise<AiSettings> {
  const stored = (await readRaw<AiSettings>(SETTING_KEYS.ai)) ?? {}
  const merged = { ...defaultAiSettings, ...stored }

  if (merged.apiKey) {
    try {
      merged.apiKey = decryptSecret(merged.apiKey)
    } catch (error) {
      log.error('API-Schlüssel konnte nicht entschlüsselt werden – vermutlich wurde NUXT_ENCRYPTION_KEY geändert.', error)
      merged.apiKey = ''
    }
  }
  if (!merged.baseUrl) merged.baseUrl = DEFAULT_BASE_URLS[merged.provider]
  return merged
}

/** Variante für die Auslieferung an den Client: der Schlüssel wird maskiert. */
export async function getAiSettingsForClient(): Promise<
  Omit<AiSettings, 'apiKey'> & { apiKeyMasked: string; apiKeySet: boolean }
> {
  const settings = await getAiSettings()
  const { apiKey, ...rest } = settings
  return { ...rest, apiKeyMasked: maskSecret(apiKey), apiKeySet: apiKey.length > 0 }
}

export async function saveAiSettings(
  patch: Partial<AiSettings> & { apiKey?: string | null },
  userId?: string,
): Promise<void> {
  const stored = (await readRaw<AiSettings>(SETTING_KEYS.ai)) ?? {}
  const next: Record<string, unknown> = { ...defaultAiSettings, ...stored, ...patch }

  // `undefined` = unverändert lassen, `null` oder "" = löschen, sonst neu verschlüsseln.
  if (patch.apiKey === undefined) {
    next.apiKey = stored.apiKey ?? ''
  } else if (!patch.apiKey) {
    next.apiKey = ''
  } else {
    next.apiKey = encryptSecret(patch.apiKey)
  }

  await writeRaw(SETTING_KEYS.ai, next, userId)
  log.info('KI-Konfiguration aktualisiert', { provider: next.provider, enabled: next.enabled })
}

export async function getUploadSettings(): Promise<UploadSettings> {
  return { ...defaultUploadSettings, ...((await readRaw<UploadSettings>(SETTING_KEYS.uploads)) ?? {}) }
}

export async function saveUploadSettings(patch: Partial<UploadSettings>, userId?: string) {
  await writeRaw(SETTING_KEYS.uploads, { ...(await getUploadSettings()), ...patch }, userId)
}

export async function getPrivacySettings(): Promise<PrivacySettings> {
  return { ...defaultPrivacySettings, ...((await readRaw<PrivacySettings>(SETTING_KEYS.privacy)) ?? {}) }
}

export async function savePrivacySettings(patch: Partial<PrivacySettings>, userId?: string) {
  await writeRaw(SETTING_KEYS.privacy, { ...(await getPrivacySettings()), ...patch }, userId)
}

export async function getAppearanceSettings(): Promise<AppearanceSettings> {
  return {
    ...defaultAppearanceSettings,
    ...((await readRaw<AppearanceSettings>(SETTING_KEYS.appearance)) ?? {}),
  }
}

export async function saveAppearanceSettings(patch: Partial<AppearanceSettings>, userId?: string) {
  await writeRaw(SETTING_KEYS.appearance, { ...(await getAppearanceSettings()), ...patch }, userId)
}

/**
 * Optionale Anbindung an Collabora Online (CODE) zum Anzeigen und Bearbeiten
 * von Office-Dokumenten (WOPI). Ohne Basis-URL: Download / Hinweis.
 */
export interface CollaboraSettings {
  enabled: boolean
  /** Öffentliche Basis-URL des Collabora-Containers, z. B. http://localhost:9980 */
  baseUrl: string
  /**
   * URL, unter der Collabora SARU erreichen kann (WOPI-Rückruf).
   * Leer = Origin der aktuellen Anfrage; in Docker oft z. B. http://host.docker.internal:3000
   */
  wopiHostUrl: string
}

export const defaultCollaboraSettings: CollaboraSettings = {
  enabled: false,
  baseUrl: '',
  wopiHostUrl: '',
}

export async function getCollaboraSettings(): Promise<CollaboraSettings> {
  return {
    ...defaultCollaboraSettings,
    ...((await readRaw<CollaboraSettings>(SETTING_KEYS.collabora)) ?? {}),
  }
}

export async function saveCollaboraSettings(patch: Partial<CollaboraSettings>, userId?: string) {
  const next = { ...(await getCollaboraSettings()), ...patch }
  // Trailing Slash entfernen – Discovery und Editor-URLs werden konsistent gebaut.
  if (typeof next.baseUrl === 'string') next.baseUrl = next.baseUrl.replace(/\/+$/, '')
  if (typeof next.wopiHostUrl === 'string') next.wopiHostUrl = next.wopiHostUrl.replace(/\/+$/, '')
  await writeRaw(SETTING_KEYS.collabora, next, userId)
  log.info('Collabora-Einstellungen aktualisiert', {
    enabled: next.enabled,
    configured: Boolean(next.baseUrl),
  })
}

/**
 * Optionaler Hermes-Agent-Container für agentische Dokumentfüllung.
 * Analog zu Ollama/Collabora: Basis-URL (+ optional API-Schlüssel).
 */
export interface HermesSettings {
  enabled: boolean
  /** z. B. http://localhost:8642 oder http://hermes:8642 */
  baseUrl: string
  /** Optional; wird verschlüsselt gespeichert. */
  apiKey: string
  timeoutMs: number
}

export const defaultHermesSettings: HermesSettings = {
  enabled: false,
  baseUrl: '',
  apiKey: '',
  timeoutMs: 300_000,
}

export async function getHermesSettings(): Promise<HermesSettings> {
  const stored = (await readRaw<HermesSettings>(SETTING_KEYS.hermes)) ?? {}
  const merged = { ...defaultHermesSettings, ...stored }
  if (merged.apiKey) {
    try {
      merged.apiKey = decryptSecret(merged.apiKey)
    } catch (error) {
      log.error('Hermes-API-Schlüssel konnte nicht entschlüsselt werden.', error)
      merged.apiKey = ''
    }
  }
  return merged
}

export async function saveHermesSettings(
  patch: Partial<HermesSettings> & { apiKey?: string | null },
  userId?: string,
): Promise<void> {
  const stored = (await readRaw<HermesSettings>(SETTING_KEYS.hermes)) ?? {}
  const next: Record<string, unknown> = { ...defaultHermesSettings, ...stored, ...patch }

  if (patch.apiKey === undefined) {
    next.apiKey = stored.apiKey ?? ''
  } else if (!patch.apiKey) {
    next.apiKey = ''
  } else {
    next.apiKey = encryptSecret(patch.apiKey)
  }

  if (typeof next.baseUrl === 'string') next.baseUrl = next.baseUrl.replace(/\/+$/, '')

  await writeRaw(SETTING_KEYS.hermes, next, userId)
  log.info('Hermes-Einstellungen aktualisiert', {
    enabled: next.enabled,
    configured: Boolean(next.baseUrl),
  })
}
