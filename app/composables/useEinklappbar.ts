const SPEICHER_PREFIX = 'saru.einklapp.v2.'

export function leseEinklappZustand(id: string): boolean | null {
  if (!import.meta.client) return null
  const gespeichert = localStorage.getItem(SPEICHER_PREFIX + id)
  if (gespeichert === null) return null
  return gespeichert === '1'
}

/**
 * Merkt sich den Ein-/Ausklappzustand eines Abschnitts in localStorage
 * (nur nach explizitem Toggle).
 *
 * Der Anfangszustand ist bewusst nur `standardOffen`: localStorage wird erst
 * nach dem Mount gelesen, damit SSR und Client-Hydration übereinstimmen.
 */
export function useEinklappbar(id: string, standardOffen = true) {
  const offen = ref(standardOffen)
  const vomBenutzerGeaendert = ref(false)

  onMounted(() => {
    const gespeichert = leseEinklappZustand(id)
    if (gespeichert !== null) offen.value = gespeichert
  })

  watch(offen, (wert) => {
    if (!import.meta.client || !vomBenutzerGeaendert.value) return
    localStorage.setItem(SPEICHER_PREFIX + id, wert ? '1' : '0')
  })

  function umschalten() {
    vomBenutzerGeaendert.value = true
    offen.value = !offen.value
  }

  return { offen, umschalten }
}
