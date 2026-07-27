import type { Role } from '#shared/types/domain'

export interface SitzungsBenutzer {
  id: string
  email: string
  name: string
  role: Role
  mustChangePassword: boolean
  preferences: Record<string, unknown>
}

/** Der angemeldete Nutzer samt Rollenprüfungen. */
export function useSitzung() {
  const benutzer = useState<SitzungsBenutzer | null>('sitzung', () => null)
  const geladen = useState('sitzung:geladen', () => false)

  const angemeldet = computed(() => benutzer.value !== null)
  const istAdmin = computed(() => benutzer.value?.role === 'admin')
  /** Leser dürfen alles sehen, aber nichts verändern. */
  const darfBearbeiten = computed(
    () => benutzer.value?.role === 'admin' || benutzer.value?.role === 'lehrkraft',
  )

  async function laden(erzwingen = false) {
    if (geladen.value && !erzwingen) return benutzer.value

    // Beim Rendern auf dem Server muss das Sitzungs-Cookie mitgereicht werden.
    const anfrage = import.meta.server ? useRequestFetch() : $fetch
    const antwort = await anfrage<{ user: SitzungsBenutzer | null }>('/api/auth/session').catch(
      () => null,
    )
    benutzer.value = antwort?.user ?? null
    geladen.value = true
    return benutzer.value
  }

  async function anmelden(email: string, passwort: string) {
    const authFetch = { credentials: 'include' as const }
    await $fetch<{ user: SitzungsBenutzer }>('/api/auth/login', {
      method: 'POST',
      body: { email, password: passwort },
      ...authFetch,
    })

    // Cookie muss vom Browser angenommen worden sein – sonst wäre die UI
    // „angemeldet“, API-Aufrufe scheiterten aber mit 401.
    const sitzung = await $fetch<{ user: SitzungsBenutzer | null }>('/api/auth/session', authFetch)
    if (!sitzung.user) {
      throw createError({
        statusCode: 401,
        statusMessage: 'NICHT_ANGEMELDET',
        message:
          'Die Anmeldung konnte nicht gespeichert werden. Bitte die Seite über HTTPS öffnen oder den Administrator kontaktieren.',
        data: { code: 'NICHT_ANGEMELDET' },
      })
    }

    benutzer.value = sitzung.user
    geladen.value = true
    // Layout vor dem Dashboard-Wechsel setzen, sonst thrashing (landing → default)
    // und DOM-Fehler wie „Cannot read properties of null (reading 'parentNode')“.
    if (import.meta.client) setPageLayout('default')
    return sitzung.user
  }

  async function abmelden() {
    await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    benutzer.value = null
    geladen.value = true
    if (import.meta.client) setPageLayout('landing')
    await navigateTo('/anmelden')
  }

  /** Nach einem Profil- oder Passwortwechsel den Zustand auffrischen. */
  function aktualisieren(teil: Partial<SitzungsBenutzer>) {
    if (benutzer.value) benutzer.value = { ...benutzer.value, ...teil }
  }

  return {
    benutzer,
    angemeldet,
    istAdmin,
    darfBearbeiten,
    laden,
    anmelden,
    abmelden,
    aktualisieren,
  }
}
