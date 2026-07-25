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
    const antwort = await $fetch<{ user: SitzungsBenutzer }>('/api/auth/login', {
      method: 'POST',
      body: { email, password: passwort },
    })
    benutzer.value = antwort.user
    geladen.value = true
    return antwort.user
  }

  async function abmelden() {
    await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    benutzer.value = null
    geladen.value = true
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
