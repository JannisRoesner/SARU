import { createHmac, timingSafeEqual } from 'node:crypto'
import { Agent, fetch as undiciFetch } from 'undici'
import { createLogger } from '../utils/logger'
import { getCollaboraSettings } from './settings.service'
import { extensionOf } from './storage.service'

const log = createLogger('collabora')

/** Office-/OpenDocument-Formate, die Collabora Online typischerweise öffnen kann. */
export const COLLABORA_EXTENSIONS = new Set([
  'doc',
  'docx',
  'odt',
  'rtf',
  'ppt',
  'pptx',
  'odp',
  'xls',
  'xlsx',
  'ods',
  'csv',
])

export function isCollaboraCandidate(fileName: string | null | undefined, mimeType?: string | null): boolean {
  const ext = fileName ? extensionOf(fileName) : ''
  if (ext && COLLABORA_EXTENSIONS.has(ext)) return true
  if (!mimeType) return false
  return (
    mimeType.includes('officedocument') ||
    mimeType.includes('msword') ||
    mimeType.includes('ms-excel') ||
    mimeType.includes('ms-powerpoint') ||
    mimeType.includes('opendocument')
  )
}

function signingKey(): Buffer {
  const raw = process.env.NUXT_ENCRYPTION_KEY ?? process.env.ENCRYPTION_KEY ?? 'saru-dev-wopi-key-min-32-chars!!'
  return Buffer.from(raw)
}

export interface WopiTokenPayload {
  assetId: string
  userId: string
  userName: string
  /** Ob Collabora Speichern/Bearbeiten erlauben darf (Lehrkraft/Admin). */
  canWrite: boolean
  exp: number
}

/** Kurzlebiger Zugriffstoken für Collabora → WOPI (ohne Session-Cookie). */
export function createWopiAccessToken(payload: Omit<WopiTokenPayload, 'exp'>, ttlSeconds = 3600): string {
  const body: WopiTokenPayload = {
    ...payload,
    canWrite: Boolean(payload.canWrite),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  }
  const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url')
  const sig = createHmac('sha256', signingKey()).update(encoded).digest('base64url')
  return `${encoded}.${sig}`
}

export function verifyWopiAccessToken(token: string | undefined): WopiTokenPayload | null {
  if (!token) return null
  const [encoded, sig] = token.split('.')
  if (!encoded || !sig) return null
  const expected = createHmac('sha256', signingKey()).update(encoded).digest('base64url')
  try {
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch {
    return null
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as WopiTokenPayload
    if (!payload.assetId || !payload.userId || !payload.exp) return null
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return {
      ...payload,
      canWrite: Boolean(payload.canWrite),
    }
  } catch {
    return null
  }
}

let discoveryCache: { configuredBaseUrl: string; resolvedBaseUrl: string; fetchedAt: number; xml: string } | null =
  null

/** CODE liefert standardmäßig ein selbstsigniertes Zertifikat – für lokale/LAN-URLs akzeptieren. */
const insecureTlsAgent = new Agent({ connect: { rejectUnauthorized: false } })

/** localhost, RFC1918 oder Link-local – typisch für lokale Collabora-Installationen. */
export function collaboraHostLooksLocal(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|169\.254\.)/.test(host)) return true
  } catch {
    /* ignore */
  }
  return false
}

/** Dev-Hinweis zum selbstsignierten Zertifikat – nicht in Produktion an Endnutzer. */
export function shouldShowCollaboraCertHint(baseUrl: string): boolean {
  if (process.env.NODE_ENV === 'production') return false
  if (process.env.NODE_ENV === 'development') return true
  return collaboraHostLooksLocal(baseUrl)
}

function allowInsecureTls(baseUrl: string): boolean {
  if (process.env.NUXT_COLLABORA_INSECURE_TLS === 'true') return true
  if (process.env.NUXT_COLLABORA_INSECURE_TLS === 'false') return false
  return collaboraHostLooksLocal(baseUrl)
}

function discoveryCandidates(baseUrl: string): string[] {
  const trimmed = baseUrl.replace(/\/+$/, '')
  const out = [trimmed]
  // Zuerst konfiguriertes Schema, dann Alternative (CODE antwortet oft nur auf eines).
  if (trimmed.startsWith('http://')) {
    out.push(`https://${trimmed.slice('http://'.length)}`)
  } else if (trimmed.startsWith('https://')) {
    out.push(`http://${trimmed.slice('https://'.length)}`)
  }
  return out
}

/** Absolute Editor-URLs auf die tatsächlich erreichbare Collabora-Origin umschreiben. */
export function rewriteToBaseOrigin(url: string, resolvedBaseUrl: string): string {
  try {
    const base = new URL(`${resolvedBaseUrl.replace(/\/+$/, '')}/`)
    const target = new URL(url, base)
    // hostname+port getrennt setzen: `host=` allein lässt in Node oft den alten Port stehen
    // (z. B. Discovery mit :9980 → öffentliche https://office…:9980).
    target.protocol = base.protocol
    target.hostname = base.hostname
    target.port = base.port
    return target.toString()
  } catch {
    return url
  }
}

/** Discovery-Cache leeren (z. B. nach geänderten Office-Einstellungen). */
export function clearCollaboraDiscoveryCache(): void {
  discoveryCache = null
}

async function fetchDiscoveryOnce(baseUrl: string): Promise<string | null> {
  try {
    const response = await undiciFetch(`${baseUrl}/hosting/discovery`, {
      signal: AbortSignal.timeout(8000),
      dispatcher: allowInsecureTls(baseUrl) ? insecureTlsAgent : undefined,
    })
    if (!response.ok) {
      log.warn('Collabora Discovery nicht erreichbar', { baseUrl, status: response.status })
      return null
    }
    return await response.text()
  } catch (error) {
    log.warn('Collabora Discovery fehlgeschlagen', { baseUrl, error })
    return null
  }
}

/**
 * Lädt die Collabora-Discovery. iframe-Links nutzen die Origin, unter der Discovery
 * tatsächlich geklappt hat (kann von der konfigurierten http/https-URL abweichen).
 */
async function loadDiscovery(configuredBaseUrl: string): Promise<{ baseUrl: string; xml: string } | null> {
  const now = Date.now()
  const configured = configuredBaseUrl.replace(/\/+$/, '')
  if (
    discoveryCache &&
    discoveryCache.configuredBaseUrl === configured &&
    now - discoveryCache.fetchedAt < 300_000
  ) {
    return { baseUrl: discoveryCache.resolvedBaseUrl, xml: discoveryCache.xml }
  }

  for (const candidate of discoveryCandidates(configured)) {
    const xml = await fetchDiscoveryOnce(candidate)
    if (!xml) continue
    if (candidate !== configured) {
      log.warn('Collabora Discovery nur unter alternativem Protokoll erreichbar', {
        configured,
        resolved: candidate,
      })
    }
    discoveryCache = {
      configuredBaseUrl: configured,
      resolvedBaseUrl: candidate,
      fetchedAt: now,
      xml,
    }
    return { baseUrl: candidate, xml }
  }
  return null
}

/** Für Diagnose/UI: true, wenn Discovery gerade erreichbar ist. */
export async function probeCollaboraDiscovery(): Promise<{
  ok: boolean
  configuredBaseUrl: string
  resolvedBaseUrl: string | null
}> {
  const settings = await getCollaboraSettings()
  const configured = settings.baseUrl.trim()
  if (!settings.enabled || !configured) {
    return { ok: false, configuredBaseUrl: configured, resolvedBaseUrl: null }
  }
  discoveryCache = null
  const discovery = await loadDiscovery(configured)
  return {
    ok: Boolean(discovery),
    configuredBaseUrl: configured,
    resolvedBaseUrl: discovery?.baseUrl ?? null,
  }
}

interface DiscoveryAction {
  name: string
  ext: string
  urlsrc: string
}

/** Parst Collabora-Discovery-`<action>`-Einträge (Reihenfolge der Attribute variiert). */
export function parseDiscoveryActions(xml: string): DiscoveryAction[] {
  const actions: DiscoveryAction[] = []
  const actionRegex = /<action\b([^>]*)\/?>/gi
  let match: RegExpExecArray | null
  while ((match = actionRegex.exec(xml))) {
    const attrs = match[1] ?? ''
    const name = /\bname=["']([^"']+)["']/i.exec(attrs)?.[1]?.toLowerCase() ?? ''
    const ext = /\bext=["']([^"']+)["']/i.exec(attrs)?.[1]?.toLowerCase() ?? ''
    const urlsrc = /\burlsrc=["']([^"']+)["']/i.exec(attrs)?.[1] ?? ''
    if (ext && urlsrc) actions.push({ name, ext, urlsrc })
  }
  return actions
}

/**
 * Ermittelt die Editor-URL für eine Dateiendung aus der Collabora-Discovery.
 * Bei Schreibrechten wird die `edit`-Action bevorzugt, sonst `view`.
 * Ohne erreichbare Discovery kein Fallback – sonst öffnet der iframe eine tote HTTP-URL.
 */
export async function resolveCollaboraEditorUrl(
  extension: string,
  preferEdit = false,
): Promise<{ urlsrc: string; baseUrl: string } | null> {
  const settings = await getCollaboraSettings()
  if (!settings.enabled || !settings.baseUrl) return null

  const ext = extension.toLowerCase()
  const discovery = await loadDiscovery(settings.baseUrl)
  if (!discovery) return null

  const matching = parseDiscoveryActions(discovery.xml).filter((a) => a.ext === ext)
  const preferredNames = preferEdit
    ? ['edit', 'view', 'view_comment']
    : ['view', 'view_comment', 'edit']
  const chosen =
    preferredNames.map((name) => matching.find((a) => a.name === name)).find(Boolean) ??
    matching[0]

  if (chosen) {
    return {
      urlsrc: absolutizeUrlsrc(discovery.baseUrl, chosen.urlsrc),
      baseUrl: discovery.baseUrl,
    }
  }

  // Discovery ohne passenden Ext-Eintrag – generischer cool.html auf der erreichbaren Basis.
  return {
    urlsrc: `${discovery.baseUrl}/browser/dist/cool.html?`,
    baseUrl: discovery.baseUrl,
  }
}

function absolutizeUrlsrc(resolvedBaseUrl: string, urlsrc: string): string {
  let absolute: string
  if (/^https?:\/\//i.test(urlsrc)) {
    absolute = urlsrc
  } else {
    try {
      absolute = new URL(urlsrc, `${resolvedBaseUrl}/`).toString()
    } catch {
      absolute = `${resolvedBaseUrl}${urlsrc.startsWith('/') ? '' : '/'}${urlsrc}`
    }
  }
  return rewriteToBaseOrigin(absolute, resolvedBaseUrl)
}

/**
 * Baut die vollständige iframe-URL für Collabora (WOPISrc + access_token).
 */
export async function buildCollaboraIframeUrl(options: {
  assetId: string
  fileName: string
  accessToken: string
  wopiHost: string
  /** true → Bearbeiten/Speichern; false → reine Ansicht. */
  canWrite?: boolean
}): Promise<string | null> {
  const canWrite = Boolean(options.canWrite)
  const ext = extensionOf(options.fileName)
  const editor = await resolveCollaboraEditorUrl(ext || 'docx', canWrite)
  if (!editor) return null

  const wopiSrc = `${options.wopiHost.replace(/\/+$/, '')}/api/wopi/files/${options.assetId}`
  const url = new URL(editor.urlsrc.includes('?') ? editor.urlsrc : `${editor.urlsrc}?`)
  // Discovery-URLs enthalten Platzhalter wie `<WOPI_SOURCE>`; wir setzen Query-Parameter explizit.
  url.searchParams.set('WOPISrc', wopiSrc)
  url.searchParams.set('access_token', options.accessToken)
  // Collabora: `edit` freischalten; Discovery-URLs setzen ggf. selbst `readonly`.
  url.searchParams.set('permission', canWrite ? 'edit' : 'readonly')
  return rewriteToBaseOrigin(
    url.toString().replace(/<WOPI_SOURCE>/gi, encodeURIComponent(wopiSrc)),
    editor.baseUrl,
  )
}

export async function isCollaboraConfigured(): Promise<boolean> {
  const settings = await getCollaboraSettings()
  return settings.enabled && Boolean(settings.baseUrl.trim())
}
