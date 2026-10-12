/**
 * Navigation in Freigabe-Links: Jeder Link innerhalb des Gast-Bereichs merkt sich per `?von=`,
 * woher man kam, damit „Zurück“ zur Stunde, zum Lernzirkel usw. führt statt immer zur Startseite.
 */
export function useGastNavigation() {
  const route = useRoute()
  const token = computed(() => String(route.params.token ?? ''))

  /** Nur Ziele innerhalb dieses Links sind erlaubt – kein offener Weiterleiter. */
  function sichererPfad(roh: unknown): string | null {
    const wert = Array.isArray(roh) ? roh[0] : roh
    if (typeof wert !== 'string') return null
    const basis = `/geteilt/${token.value}`
    if (wert !== basis && !wert.startsWith(`${basis}/`) && !wert.startsWith(`${basis}?`)) return null
    return wert
  }

  /** Aktuelle Seite samt ihrem eigenen Rückweg – so lässt sich eine Kette zurückgehen. */
  const aktuellerPfad = computed(() => route.fullPath)

  /** Link auf eine Unterseite, der den Rückweg hierher mitgibt. */
  function ziel(pfad: string): { path: string; query: { von: string } } {
    return { path: pfad, query: { von: aktuellerPfad.value } }
  }

  const zurueck = computed(() => {
    const pfad = sichererPfad(route.query.von)
    const basis = `/geteilt/${token.value}`
    if (!pfad) return { to: basis, label: 'Zur Übersicht' }
    const label = pfad.includes('/stunde/')
      ? 'Zur Stunde'
      : pfad.includes('/material/')
        ? 'Zurück'
        : 'Zur Übersicht'
    return { to: pfad, label }
  })

  return { token, ziel, zurueck }
}
