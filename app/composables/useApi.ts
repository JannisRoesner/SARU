import type { FetchError } from 'ofetch'

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

export function toApiFehler(error: unknown): ApiFehler {
  const fetchError = error as FetchError<{
    statusMessage?: string
    message?: string
    data?: { code?: string; fields?: Record<string, string[]> }
  }>

  const payload = fetchError?.data
  return {
    code: payload?.data?.code ?? 'UNBEKANNT',
    nachricht:
      payload?.statusMessage ??
      payload?.message ??
      (fetchError?.message?.includes('fetch')
        ? 'Der Server ist nicht erreichbar.'
        : 'Es ist ein unerwarteter Fehler aufgetreten.'),
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
