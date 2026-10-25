import { createHmac, timingSafeEqual } from 'node:crypto'
import { Readable } from 'node:stream'
import { unzipSync } from 'fflate'
import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { html5Startseite, istHtml5PaketDatei } from '#shared/utils/interaktiv'
import { useDatabase } from '../database/client'
import { materialAssets } from '../database/schema'
import { appError, notFound } from '../utils/errors'
import { parseByteRange } from '../utils/byte-range'
import { ZipLeser } from './sicherung/zip'
import { resolveStoragePath } from './storage.service'

/**
 * HTML5-Pakete (.html5.zip) werden nicht entpackt gespeichert, sondern Datei für Datei aus dem
 * ZIP ausgeliefert. Die Adresse enthält einen signierten Schlüssel für genau ein Paket, damit der
 * abgeschottete iframe (ohne `allow-same-origin`, also ohne Cookies) relative Pfade nachladen
 * kann. Jede Antwort trägt zusätzlich eine CSP-Sandbox – auch wenn jemand die Adresse direkt
 * öffnet, läuft das Verlags-JavaScript nie im Kontext von SARU.
 */

const SCHLUESSEL_GUELTIG_SEKUNDEN = 6 * 3600
/** Einträge bis zu dieser Größe werden für Range-Anfragen (Videos spulen) gepuffert. */
const MAX_PUFFER_BYTES = 64 * 1024 * 1024

function signierSchluessel(): Buffer {
  const raw = process.env.NUXT_ENCRYPTION_KEY ?? process.env.ENCRYPTION_KEY ?? 'saru-dev-wopi-key-min-32-chars!!'
  return Buffer.from(`html5-paket:${raw}`)
}

function signatur(daten: string): string {
  return createHmac('sha256', signierSchluessel()).update(daten).digest('base64url')
}

/** `<assetId>.<ablauf>.<signatur>` – gilt nur für dieses eine Paket und läuft nach Stunden ab. */
export function html5Schluessel(assetId: string, jetzt = Date.now()): string {
  const daten = `${assetId}.${Math.floor(jetzt / 1000) + SCHLUESSEL_GUELTIG_SEKUNDEN}`
  return `${daten}.${signatur(daten)}`
}

/** Prüft den Schlüssel und gibt die Asset-ID zurück (oder null). */
export function pruefeHtml5Schluessel(schluessel: string | undefined, jetzt = Date.now()): string | null {
  const teile = (schluessel ?? '').split('.')
  if (teile.length !== 3) return null
  const [assetId, ablauf, sig] = teile as [string, string, string]
  const erwartet = Buffer.from(signatur(`${assetId}.${ablauf}`))
  const erhalten = Buffer.from(sig)
  if (erwartet.length !== erhalten.length || !timingSafeEqual(erwartet, erhalten)) return null
  if (!/^\d+$/.test(ablauf) || Number(ablauf) < Math.floor(jetzt / 1000)) return null
  return assetId
}

/**
 * Prüft beim Hochladen, ob das ZIP ein abspielbares HTML5-Paket ist, und liefert die Startseite.
 * Liest nur das Inhaltsverzeichnis (fflate entpackt mit `filter: () => false` nichts).
 */
export function pruefeHtml5Paket(buffer: Buffer, fileName: string): string {
  const namen: string[] = []
  try {
    unzipSync(new Uint8Array(buffer), {
      filter: (eintrag) => {
        namen.push(eintrag.name.replace(/\\/g, '/'))
        return false
      },
    })
  } catch {
    throw appError('DATEITYP_NICHT_ERLAUBT', `„${fileName}“ ist kein gültiges ZIP-Archiv.`)
  }
  if (namen.some((n) => n.startsWith('/') || n.split('/').includes('..'))) {
    throw appError('DATEITYP_NICHT_ERLAUBT', `„${fileName}“ enthält ungültige Pfade.`)
  }
  const start = html5Startseite(namen)
  if (!start) {
    throw appError(
      'DATEITYP_NICHT_ERLAUBT',
      `In „${fileName}“ fehlt eine eindeutige Startseite (index.html oder genau eine HTML-Datei).`,
    )
  }
  return start
}

/** Feste Bühnengröße des Inhalts in CSS-Pixeln; der Player skaliert sie passend ein. */
export interface Html5Buehne {
  breite: number
  /** null: nur die Breite ist bekannt (Viewport-Angabe) – die Höhe folgt der Fläche. */
  hoehe: number | null
}

/**
 * Optionale Angaben im Paket – in der Wurzel des ZIPs oder neben der Startseite,
 * z. B. `{ "breite": 1024, "hoehe": 620 }`.
 */
export const HTML5_MANIFEST = 'saru-html5.json'

function groesse(wert: unknown): number | null {
  const zahl = Number(wert)
  return Number.isInteger(zahl) && zahl >= 100 && zahl <= 8000 ? zahl : null
}

/** Bühne aus dem Manifest, sonst die Breite aus `<meta name="viewport" content="width=800">`. */
export function html5BuehneAus(manifest: string | null, startseite: string | null): Html5Buehne | null {
  if (manifest) {
    try {
      const daten = JSON.parse(manifest) as Record<string, unknown>
      const breite = groesse(daten.breite)
      const hoehe = groesse(daten.hoehe)
      if (breite) return { breite, hoehe }
    } catch {
      // Ungültiges Manifest – wie ohne Manifest behandeln.
    }
  }
  const meta = /<meta[^>]+name=["']?viewport["']?[^>]*>/i.exec(startseite ?? '')?.[0] ?? ''
  const breite = groesse(/content=["'][^"']*\bwidth\s*=\s*(\d+)/i.exec(meta)?.[1])
  return breite ? { breite, hoehe: null } : null
}

interface OffenesPaket {
  leser: ZipLeser
  start: string | null
  buehne: Html5Buehne | null
}

async function textAusPaket(leser: ZipLeser, name: string | null): Promise<string | null> {
  const eintrag = name ? leser.eintraege.get(name) : undefined
  if (!eintrag) return null
  try {
    return (await leser.puffer(eintrag, 1024 * 1024)).toString('utf8')
  } catch {
    return null
  }
}

/** Geöffnete Pakete (Inhaltsverzeichnis) – ein Tafelbild lädt Dutzende Dateien nacheinander. */
const offen = new Map<string, Promise<OffenesPaket>>()
const MAX_OFFEN = 32

function paketOeffnen(storageKey: string) {
  let eintrag = offen.get(storageKey)
  if (!eintrag) {
    eintrag = ZipLeser.oeffnen(resolveStoragePath(storageKey)).then(async (leser) => {
      const start = html5Startseite(leser.eintraege.keys())
      const ordner = start?.includes('/') ? start.slice(0, start.lastIndexOf('/') + 1) : ''
      const manifest =
        (await textAusPaket(leser, HTML5_MANIFEST)) ?? (await textAusPaket(leser, `${ordner}${HTML5_MANIFEST}`))
      const buehne = html5BuehneAus(manifest, await textAusPaket(leser, start))
      return { leser, start, buehne }
    })
    eintrag.catch(() => offen.delete(storageKey))
    if (offen.size >= MAX_OFFEN) offen.delete(offen.keys().next().value!)
    offen.set(storageKey, eintrag)
  }
  return eintrag
}

async function html5Asset(assetId: string) {
  const [asset] = await useDatabase()
    .select({ kind: materialAssets.kind, storageKey: materialAssets.storageKey, fileName: materialAssets.fileName })
    .from(materialAssets)
    .where(eq(materialAssets.id, assetId))
    .limit(1)
  if (!asset || asset.kind !== 'datei' || !asset.storageKey || !istHtml5PaketDatei(asset.fileName)) {
    throw notFound('Das HTML5-Paket')
  }
  return asset as { storageKey: string; fileName: string }
}

/** Adresse der Startseite für den Player – Rechte prüft der aufrufende Endpunkt. */
export async function html5Startadresse(assetId: string): Promise<{ url: string; buehne: Html5Buehne | null }> {
  const asset = await html5Asset(assetId)
  const { start, buehne } = await paketOeffnen(asset.storageKey)
  if (!start) throw appError('UNGUELTIGE_EINGABE', 'Das HTML5-Paket hat keine eindeutige Startseite.')
  const pfad = start.split('/').map(encodeURIComponent).join('/')
  return { url: `/api/html5/${html5Schluessel(assetId)}/${pfad}`, buehne }
}

const TYPEN: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml',
  txt: 'text/plain; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  cur: 'image/x-icon',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
}

export function html5Inhaltstyp(pfad: string): string {
  return TYPEN[pfad.toLowerCase().split('.').pop() ?? ''] ?? 'application/octet-stream'
}

/**
 * Sandbox ohne `allow-same-origin`: eigener, undurchsichtiger Ursprung – kein Zugriff auf
 * Cookies, Speicher oder Seiten von SARU. Nachladen nur aus demselben Paket (bzw. Server).
 */
export const HTML5_CSP = [
  'sandbox allow-scripts allow-popups allow-forms allow-modals allow-pointer-lock',
  "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ')

/** Liefert eine Datei aus dem Paket aus. `pfad` ist der Pfad im ZIP (bereits URL-dekodiert). */
export async function sendeHtml5Datei(event: H3Event, schluessel: string | undefined, pfad: string) {
  const assetId = pruefeHtml5Schluessel(schluessel)
  if (!assetId) throw appError('KEINE_BERECHTIGUNG', 'Der Zugriff auf das HTML5-Paket ist abgelaufen. Bitte die Seite neu laden.')
  const asset = await html5Asset(assetId)
  const { leser } = await paketOeffnen(asset.storageKey)
  const eintrag = leser.eintraege.get(pfad)
  if (!eintrag) throw notFound('Die Datei im HTML5-Paket')

  setResponseHeader(event, 'content-type', html5Inhaltstyp(pfad))
  setResponseHeader(event, 'content-security-policy', HTML5_CSP)
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  setResponseHeader(event, 'referrer-policy', 'no-referrer')
  setResponseHeader(event, 'cache-control', 'private, max-age=3600')
  setResponseHeader(event, 'accept-ranges', 'bytes')

  const bereich = parseByteRange(getRequestHeader(event, 'range'), eintrag.groesse)
  if (bereich === 'ungueltig') {
    setResponseStatus(event, 416)
    setResponseHeader(event, 'content-range', `bytes */${eintrag.groesse}`)
    return ''
  }
  if (bereich && eintrag.groesse <= MAX_PUFFER_BYTES) {
    const daten = await leser.puffer(eintrag, MAX_PUFFER_BYTES)
    setResponseStatus(event, 206)
    setResponseHeader(event, 'content-range', `bytes ${bereich.start}-${bereich.end}/${eintrag.groesse}`)
    setResponseHeader(event, 'content-length', bereich.end - bereich.start + 1)
    return sendStream(event, Readable.from([daten.subarray(bereich.start, bereich.end + 1)]))
  }
  setResponseHeader(event, 'content-length', eintrag.groesse)
  return sendStream(event, await leser.stream(eintrag))
}
