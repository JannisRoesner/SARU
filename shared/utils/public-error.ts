const FEHLERCODE = /^[A-Z][A-Z0-9_]+$/

/** Erkennt Meldungen, die Endnutzenden nicht gezeigt werden dürfen. */
export function istTechnischeMeldung(message: string): boolean {
  const m = message.toLowerCase().trim()
  if (!m) return true

  return (
    m.includes('failed query') ||
    m.includes('password_hash') ||
    m.includes('econnrefused') ||
    m.includes('connect timeout') ||
    m.includes('connection terminated') ||
    m.includes('connection refused') ||
    m.includes('fetch failed') ||
    m.includes('network error') ||
    m.includes('socket hang up') ||
    m.includes('relation ') ||
    m.includes('does not exist') ||
    m.includes('syntax error') ||
    m.includes('duplicate key') ||
    m.includes('violates') ||
    m.includes('constraint') ||
    m.includes('enoent') ||
    m.includes('eacces') ||
    m.includes('unexpected token') ||
    m.includes('is not valid json') ||
    m.includes('cannot read propert') ||
    m.includes('undefined is not') ||
    m.includes('at object.') ||
    m.includes('at async') ||
    m.startsWith('error:') ||
    /^\[(get|post|put|patch|delete)\]\s+"/i.test(message) ||
    /^\s*(select|insert|update|delete)\s/i.test(message) ||
    /from\s+"[\w.]+"/i.test(message) ||
    FEHLERCODE.test(message.trim())
  )
}

function hatAppFehlerStatus(error: unknown): error is { statusCode: number; message?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof (error as { statusCode: unknown }).statusCode === 'number'
  )
}

/**
 * Liefert eine für Nutzende verständliche Meldung.
 * Bekannte App-Fehler (HTTP 4xx) mit lesbarem Text werden übernommen,
 * rohe Exceptions und technische Details durch den Fallback ersetzt.
 */
export function oeffentlicheFehlermeldung(error: unknown, fallback: string): string {
  if (hatAppFehlerStatus(error)) {
    const { statusCode, message } = error
    if (statusCode < 500 && message && !istTechnischeMeldung(message)) {
      return message
    }
  }
  return fallback
}

/** Verständliche Meldung bei abgelehnten KI-Anfragen (für Lehrkräfte, nicht Admin-Tests). */
export function kiAnbieterFehlermeldung(status: number, kontext: string): string {
  if (status === 401 || status === 403) {
    return `${kontext} wurde abgelehnt. Bitte wende dich an die Administration – die KI-Einstellungen müssen geprüft werden.`
  }
  if (status === 404) {
    return `${kontext} konnte nicht ausgeführt werden. Das gewählte Modell ist möglicherweise nicht verfügbar.`
  }
  if (status === 429) {
    return `${kontext} ist vorübergehend nicht möglich – zu viele Anfragen. Bitte kurz warten und erneut versuchen.`
  }
  if (status >= 500) {
    return `${kontext} ist fehlgeschlagen. Der KI-Anbieter antwortet derzeit nicht zuverlässig – bitte später erneut versuchen.`
  }
  return `${kontext} ist fehlgeschlagen. Bitte später erneut versuchen.`
}
