import type { H3Event } from 'h3'
import { requireFreigabe, type FreigabeUmfang } from '../services/share.service'
import { clientIp } from './auth'
import { checkRateLimit } from './rate-limit'

/**
 * Einstieg für alle Gast-Endpunkte unter `/api/geteilt/<schlüssel>/…`:
 * begrenzt Aufrufe pro IP und prüft Schlüssel samt Umfang.
 */
export async function gastZugriff(event: H3Event): Promise<FreigabeUmfang> {
  checkRateLimit(`geteilt:${clientIp(event) ?? 'unbekannt'}`, {
    limit: 600,
    windowMs: 60_000,
    message: 'Zu viele Aufrufe über diesen Link. Bitte kurz warten.',
  })
  setResponseHeader(event, 'referrer-policy', 'no-referrer')
  setResponseHeader(event, 'x-robots-tag', 'noindex, nofollow')
  return requireFreigabe(event)
}

/** Basis-Adresse der Datei-Endpunkte für diesen Link. */
export function gastDateiBasis(event: H3Event): string {
  return `/api/geteilt/${getRouterParam(event, 'token')}/dateien`
}
