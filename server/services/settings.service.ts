import { eq } from 'drizzle-orm'
import {
  AI_ROLLEN,
  type AiProvider,
  type AiRolle,
  type AiRollenAnbieterId,
} from '#shared/types/domain'
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
} as const

export type AiProviderId = AiProvider

/** Verbindung, über die eine Aufgabe (Chat, Vision, Embeddings) ihre Anfragen schickt. */
export interface AiVerbindung {
  provider: AiProviderId
  baseUrl: string
  apiKey: string
}

/** Eigener Anbieter für eine Aufgabe; `standard` übernimmt die Verbindung des Standardanbieters. */
export interface AiRollenAnbieter {
  provider: AiRollenAnbieterId
  /** Leer lassen, um die Standard-URL des Anbieters zu verwenden. */
  baseUrl: string
  /** Im Klartext nur im Speicher; in der Datenbank liegt der Wert verschlüsselt. */
  apiKey: string
}

export type AiRollenEinstellungen = Record<AiRolle, AiRollenAnbieter>

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
  /** Suche ausschließlich semantisch statt kombiniert mit der Volltextsuche. */
  vectorOnlySearch: boolean
  /** Seiten von PDFs, Office-Dateien und Bildern zusätzlich als Bild einbetten (multimodale Modelle). */
  embedImages: boolean
  temperature: number
  maxOutputTokens: number
  timeoutMs: number
  /**
   * Denkmodelle dürfen beim Lösen und Prüfen von Musterlösungen nachdenken.
   * Metadaten, Kurzbeschreibungen und Texterkennung bleiben immer ohne Denkmodus.
   */
  denkmodusMusterloesungen: boolean
  /** Tokens fürs Nachdenken, zusätzlich zum Antwortbudget der jeweiligen Anfrage. */
  denkBudget: number
  /** Von OpenRouter für die Aufruferkennung ausgewertet. */
  refererUrl: string
  appTitle: string
  /**
   * Anbieter je Aufgabe. Fehlt der Eintrag (ältere Installationen), gilt für
   * alle Aufgaben der Standardanbieter oben.
   */
  rollen?: AiRollenEinstellungen
}

export const DEFAULT_BASE_URLS: Record<AiProviderId, string> = {
  openai: 'https://api.openai.com/v1',
  ollama: 'http://localhost:11434/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  openai_kompatibel: 'http://localhost:8080/v1',
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
  // Modellnamen legt der Server fest (z. B. llama.cpp-Alias) – Auswahl kommt aus /models.
  openai_kompatibel: {
    chatModel: '',
    visionModel: '',
    embeddingModel: '',
    useVision: true,
  },
}

export const STANDARD_ROLLE: AiRollenAnbieter = { provider: 'standard', baseUrl: '', apiKey: '' }

export function standardRollen(): AiRollenEinstellungen {
  return { chat: { ...STANDARD_ROLLE }, vision: { ...STANDARD_ROLLE }, embedding: { ...STANDARD_ROLLE } }
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
  vectorOnlySearch: false,
  embedImages: false,
  temperature: 0.2,
  maxOutputTokens: 4000,
  timeoutMs: 180_000,
  denkmodusMusterloesungen: false,
  denkBudget: 4000,
  refererUrl: '',
  appTitle: 'SARU',
  rollen: standardRollen(),
}

function verbindungDesStandards(settings: AiSettings): AiVerbindung {
  return {
    provider: settings.provider,
    baseUrl: settings.baseUrl || DEFAULT_BASE_URLS[settings.provider],
    apiKey: settings.apiKey,
  }
}

function eigeneVerbindung(rolle: AiRollenAnbieter | undefined): AiVerbindung | null {
  if (!rolle || rolle.provider === 'standard') return null
  return {
    provider: rolle.provider,
    baseUrl: rolle.baseUrl || DEFAULT_BASE_URLS[rolle.provider],
    apiKey: rolle.apiKey,
  }
}

/**
 * Verbindung, über die eine Aufgabe ihre Anfragen schickt. Ohne eigenes
 * Vision-Modell arbeitet Vision mit dem Chat-Modell – und damit auch über
 * dessen Anbieter.
 */
export function aiVerbindung(settings: AiSettings, rolle: AiRolle): AiVerbindung {
  if (rolle === 'vision' && !settings.visionModel?.trim()) return aiVerbindung(settings, 'chat')
  return eigeneVerbindung(settings.rollen?.[rolle]) ?? verbindungDesStandards(settings)
}

/**
 * Konfiguration, die direkt den Server einer Aufgabe anspricht – für Modellliste
 * und Verbindungstest, auch solange deren Modell noch nicht gewählt ist.
 * Ohne eigenen Anbieter gilt die wirksame Verbindung der Aufgabe.
 */
export function aiSettingsFuerVerbindungstest(settings: AiSettings, rolle: AiRolle): AiSettings {
  const eigene = eigeneVerbindung(settings.rollen?.[rolle])
  return eigene ? { ...aiSettingsFuerRolle(settings, rolle), ...eigene } : aiSettingsFuerRolle(settings, rolle)
}

/** Modell, das eine Aufgabe ohne ausdrückliche Vorgabe verwendet. */
export function aiModell(settings: AiSettings, rolle: AiRolle): string {
  if (rolle === 'embedding') return settings.embeddingModel?.trim() ?? ''
  if (rolle === 'vision') return settings.visionModel?.trim() || settings.chatModel?.trim() || ''
  return settings.chatModel?.trim() ?? ''
}

/** Ob zwei Verbindungen denselben Server mit demselben Anbietertyp ansprechen. */
export function gleicheVerbindung(a: AiVerbindung, b: AiVerbindung): boolean {
  const url = (wert: string) => wert.trim().replace(/\/+$/, '').toLowerCase()
  return a.provider === b.provider && url(a.baseUrl) === url(b.baseUrl)
}

function alsRolle(verbindung: AiVerbindung): AiRollenAnbieter {
  return { provider: verbindung.provider, baseUrl: verbindung.baseUrl, apiKey: verbindung.apiKey }
}

/**
 * Konfiguration aus Sicht einer Aufgabe: Anbieter, Adresse und Schlüssel oben
 * sind die der Aufgabe; die übrigen Aufgaben behalten ihre Verbindung. So
 * prüfen etwa PDF-Pfade die Fähigkeiten des richtigen Anbieters, und eine
 * Texterkennung innerhalb eines Chat-Laufs geht weiterhin an den Vision-Anbieter.
 *
 * Für Vision werden Chat- und Vision-Modell zum wirksamen Vision-Modell und
 * Chat folgt der Vision-Verbindung: Folgeschritte eines Vision-Laufs (auch
 * reine Textanfragen mit demselben Modell) bleiben beim selben Anbieter.
 */
export function aiSettingsFuerRolle(settings: AiSettings, rolle: AiRolle): AiSettings {
  const rollen = standardRollen()
  if (rolle !== 'embedding') rollen.embedding = alsRolle(aiVerbindung(settings, 'embedding'))
  if (rolle !== 'vision' && settings.visionModel?.trim()) rollen.vision = alsRolle(aiVerbindung(settings, 'vision'))
  if (rolle === 'embedding') rollen.chat = alsRolle(aiVerbindung(settings, 'chat'))

  const flach: AiSettings = { ...settings, ...aiVerbindung(settings, rolle), rollen }
  if (rolle !== 'vision') return flach
  const modell = aiModell(settings, 'vision')
  return { ...flach, chatModel: modell, visionModel: modell }
}

type GespeicherteRollen = Partial<Record<AiRolle, Partial<AiRollenAnbieter>>>

/** Rollen aus der Datenbank mit Standardwerten auffüllen (fehlende Einträge = Standardanbieter). */
function rollenAuffuellen(stored: GespeicherteRollen | undefined): AiRollenEinstellungen {
  const rollen = standardRollen()
  for (const rolle of AI_ROLLEN) rollen[rolle] = { ...STANDARD_ROLLE, ...stored?.[rolle] }
  return rollen
}

function schluesselEntschluesseln(wert: string, wo: string): string {
  if (!wert) return ''
  try {
    return decryptSecret(wert)
  } catch (error) {
    log.error(
      `API-Schlüssel (${wo}) konnte nicht entschlüsselt werden – vermutlich wurde NUXT_ENCRYPTION_KEY geändert.`,
      error,
    )
    return ''
  }
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
  maxBytes: Number(process.env.NUXT_MAX_UPLOAD_BYTES ?? 268_435_456),
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

/** Liefert die KI-Konfiguration inklusive entschlüsselter Schlüssel (nur serverseitig verwenden!). */
export async function getAiSettings(): Promise<AiSettings> {
  const stored = (await readRaw<AiSettings>(SETTING_KEYS.ai)) ?? {}
  const rollen = rollenAuffuellen(stored.rollen)
  const merged: AiSettings = { ...defaultAiSettings, ...stored, rollen }

  merged.apiKey = schluesselEntschluesseln(merged.apiKey, 'Standardanbieter')
  if (!merged.baseUrl) merged.baseUrl = DEFAULT_BASE_URLS[merged.provider]
  for (const rolle of AI_ROLLEN) {
    const eintrag = rollen[rolle]
    eintrag.apiKey = schluesselEntschluesseln(eintrag.apiKey, rolle)
    if (eintrag.provider !== 'standard' && !eintrag.baseUrl) eintrag.baseUrl = DEFAULT_BASE_URLS[eintrag.provider]
  }
  return merged
}

export interface AiRollenAnbieterFuerClient extends AiRollenAnbieter {
  apiKeyGesetzt: boolean
}

export type AiSettingsFuerClient = Omit<AiSettings, 'rollen'> & {
  apiKeyGesetzt: boolean
  rollen: Record<AiRolle, AiRollenAnbieterFuerClient>
}

/** Variante für die Auslieferung an den Client: alle Schlüssel werden maskiert. */
export function aiSettingsFuerClient(settings: AiSettings): AiSettingsFuerClient {
  const rollen = settings.rollen ?? standardRollen()
  const maskiert = (rolle: AiRolle): AiRollenAnbieterFuerClient => ({
    ...rollen[rolle],
    apiKey: maskSecret(rollen[rolle].apiKey),
    apiKeyGesetzt: Boolean(rollen[rolle].apiKey),
  })
  return {
    ...settings,
    apiKey: maskSecret(settings.apiKey),
    apiKeyGesetzt: Boolean(settings.apiKey),
    rollen: { chat: maskiert('chat'), vision: maskiert('vision'), embedding: maskiert('embedding') },
  }
}

export type AiRollenPatch = Partial<
  Record<AiRolle, Partial<Omit<AiRollenAnbieter, 'apiKey'>> & { apiKey?: string | null }>
>

export type AiSettingsPatch = Partial<Omit<AiSettings, 'apiKey' | 'rollen'>> & {
  apiKey?: string | null
  rollen?: AiRollenPatch
}

/**
 * Wendet einen noch nicht gespeicherten Formularstand auf die Konfiguration an,
 * etwa für Verbindungstest und Modellliste. Leere Schlüssel bleiben wie gespeichert.
 */
export function aiSettingsMitEntwurf(stored: AiSettings, patch: AiSettingsPatch): AiSettings {
  const { rollen: rollenPatch, apiKey, ...rest } = patch
  const rollen = rollenAuffuellen(stored.rollen)
  for (const rolle of AI_ROLLEN) {
    const eintrag = rollenPatch?.[rolle]
    if (!eintrag) continue
    const provider = eintrag.provider ?? rollen[rolle].provider
    rollen[rolle] = {
      provider,
      baseUrl: eintrag.baseUrl || (provider === 'standard' ? '' : DEFAULT_BASE_URLS[provider]),
      apiKey: eintrag.apiKey || rollen[rolle].apiKey,
    }
  }
  const merged: AiSettings = { ...stored, ...rest, apiKey: apiKey || stored.apiKey, rollen }
  if (!merged.baseUrl) merged.baseUrl = DEFAULT_BASE_URLS[merged.provider]
  return merged
}

/** `undefined` = unverändert lassen, `null` oder "" = löschen, sonst neu verschlüsseln. */
function schluesselFuerSpeicher(neu: string | null | undefined, gespeichert: string | undefined): string {
  if (neu === undefined) return gespeichert ?? ''
  if (!neu) return ''
  return encryptSecret(neu)
}

export async function saveAiSettings(patch: AiSettingsPatch, userId?: string): Promise<void> {
  const stored = (await readRaw<AiSettings>(SETTING_KEYS.ai)) ?? {}
  const { rollen: rollenPatch, ...rest } = patch
  const next: Record<string, unknown> = { ...defaultAiSettings, ...stored, ...rest }
  next.apiKey = schluesselFuerSpeicher(patch.apiKey, stored.apiKey)

  // Die Schlüssel der Rollen liegen wie der Hauptschlüssel verschlüsselt in der Datenbank.
  const rollen = rollenAuffuellen(stored.rollen)
  for (const rolle of AI_ROLLEN) {
    const eintrag = rollenPatch?.[rolle]
    if (!eintrag) continue
    rollen[rolle] = {
      provider: eintrag.provider ?? rollen[rolle].provider,
      baseUrl: (eintrag.baseUrl ?? rollen[rolle].baseUrl).trim(),
      apiKey: schluesselFuerSpeicher(eintrag.apiKey, rollen[rolle].apiKey),
    }
  }
  next.rollen = rollen

  await writeRaw(SETTING_KEYS.ai, next, userId)
  log.info('KI-Konfiguration aktualisiert', {
    provider: next.provider,
    enabled: next.enabled,
    rollen: { chat: rollen.chat.provider, vision: rollen.vision.provider, embedding: rollen.embedding.provider },
  })
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

