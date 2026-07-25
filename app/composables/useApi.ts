import type { FetchError } from 'ofetch'
import { istTechnischeMeldung } from '#shared/utils/public-error'

/**
 * Übersetzt einen fehlgeschlagenen Aufruf in eine Meldung, die man Nutzenden
 * zeigen kann. Der Server liefert bei Validierungsfehlern zusätzlich die
 * betroffenen Felder mit.
 */
export interface ApiFehler {
  code: string
  nachricht: string
  felder: Record<string, string[]>
  status: number
}

/** Fallback, falls der Server nur den Code und keine lesbare message liefert. */
const MELDUNG_NACH_CODE: Record<string, string> = {
  NICHT_ANGEMELDET: 'Bitte melde dich an, um fortzufahren.',
  KEINE_BERECHTIGUNG: 'Für diese Aktion fehlt die Berechtigung.',
  NICHT_GEFUNDEN: 'Der Eintrag wurde nicht gefunden.',
  UNGUELTIGE_EINGABE: 'Die Eingabe ist ungültig.',
  KONFLIKT: 'Der Vorgang steht im Konflikt mit dem aktuellen Stand.',
  DATEI_ZU_GROSS: 'Die Datei ist zu groß.',
  DATEITYP_NICHT_ERLAUBT: 'Dieser Dateityp ist nicht erlaubt.',
  KI_NICHT_KONFIGURIERT: 'KI ist noch nicht eingerichtet.',
  KI_FEHLER: 'Die KI-Anfrage ist fehlgeschlagen.',
  IMPORT_FEHLER: 'Der Import ist fehlgeschlagen.',
  RATE_LIMIT: 'Zu viele Anfragen. Bitte kurz warten.',
  INTERNER_FEHLER: 'Es ist ein interner Fehler aufgetreten.',
}

/** statusMessage trägt bei uns den Fehlercode (z. B. NICHT_ANGEMELDET), keine UI-Meldung. */
function istFehlercode(wert: string | undefined | null): wert is string {
  return Boolean(wert && /^[A-Z][A-Z0-9_]+$/.test(wert))
}

function lesbareNachricht(wert: string | undefined | null): string | undefined {
  if (!wert || istFehlercode(wert)) return undefined
  // ofetch-Format wie `[POST] "/api/...": 401 NICHT_ANGEMELDET`
  if (/^\[(GET|POST|PUT|PATCH|DELETE)\]\s+"/i.test(wert)) return undefined
  if (istTechnischeMeldung(wert)) return undefined
  return wert
}

export function toApiFehler(error: unknown): ApiFehler {
  const fetchError = error as FetchError<{
    statusMessage?: string
    message?: string
    data?: { code?: string; fields?: Record<string, string[]> }
  }>

  const payload = fetchError?.data
  const statusMessage = payload?.statusMessage
  const code =
    payload?.data?.code ?? (istFehlercode(statusMessage) ? statusMessage : undefined) ?? 'UNBEKANNT'

  const nachricht =
    lesbareNachricht(payload?.message) ??
    lesbareNachricht(payload?.statusMessage) ??
    lesbareNachricht(fetchError?.message) ??
    MELDUNG_NACH_CODE[code] ??
    (fetchError?.message?.toLowerCase().includes('fetch')
      ? 'Der Server ist nicht erreichbar.'
      : 'Es ist ein unerwarteter Fehler aufgetreten.')

  return {
    code,
    nachricht,
    felder: payload?.data?.fields ?? {},
    status: fetchError?.statusCode ?? 0,
  }
}

/**
 * Kapselt `$fetch` samt Fehlerbehandlung und Hinweismeldung. Aufrufe, die den
 * Datenbestand verändern, sollen darüber laufen, damit Fehler überall gleich
 * dargestellt werden.
 */
export function useApi() {
  const hinweise = useHinweise()
  const laeuft = ref(false)

  async function aufruf<T>(
    request: string,
    options: Parameters<typeof $fetch>[1] & {
      /** Meldung bei Erfolg; ohne Angabe wird keine gezeigt. */
      erfolgsmeldung?: string
      /** Fehler still behandeln und dem Aufrufer überlassen. */
      stumm?: boolean
    } = {},
  ): Promise<T | null> {
    const { erfolgsmeldung, stumm, ...fetchOptions } = options
    laeuft.value = true
    try {
      const ergebnis = await $fetch<T>(request, fetchOptions)
      if (erfolgsmeldung) hinweise.erfolg(erfolgsmeldung)
      return ergebnis
    } catch (error) {
      const fehler = toApiFehler(error)
      if (!stumm) hinweise.fehler(fehler.nachricht)
      if (stumm) throw fehler
      return null
    } finally {
      laeuft.value = false
    }
  }

  return { aufruf, laeuft: readonly(laeuft) }
}
