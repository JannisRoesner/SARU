import { eq } from 'drizzle-orm'
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

export const defaultAiSettings: AiSettings = {
  enabled: false,
  provider: 'openai',
  baseUrl: '',
  apiKey: '',
  chatModel: 'gpt-4o-mini',
  visionModel: '',
  useVision: true,
  embeddingsEnabled: false,
  embeddingModel: 'text-embedding-3-small',
  temperature: 0.2,
  maxOutputTokens: 4000,
  timeoutMs: 120_000,
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
