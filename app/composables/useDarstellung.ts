export const FARBDESIGNS = [
  { id: 'indigo', name: 'Indigo & Türkis', primaer: '#5b5bd6', akzent: '#2bb3a3' },
  { id: 'smaragd', name: 'Smaragd & Kupfer', primaer: '#2f9e70', akzent: '#d4813f' },
  { id: 'bernstein', name: 'Bernstein & Blau', primaer: '#c07a2c', akzent: '#4a5fd0' },
  { id: 'rosenholz', name: 'Rosenholz & Petrol', primaer: '#c14a5e', akzent: '#3f8ba3' },
  { id: 'schiefer', name: 'Schiefer & Cyan', primaer: '#5a6472', akzent: '#3f9aad' },
] as const

export type FarbdesignId = (typeof FARBDESIGNS)[number]['id']
export type Farbmodus = 'hell' | 'dunkel' | 'system'

/**
 * Verwaltet Farbmodus und Farbdesign. Die Auswahl liegt am Nutzerkonto, damit
 * sie geräteübergreifend gilt; zusätzlich wird sie lokal gespiegelt, um beim
 * Laden kein Aufblitzen des falschen Modus zu erzeugen.
 */
export function useDarstellung() {
  const modus = useState<Farbmodus>('farbmodus', () => 'system')
  const design = useState<FarbdesignId>('farbdesign', () => 'indigo')
  const systemDunkel = useState('system-dunkel', () => false)

  const istDunkel = computed(() =>
    modus.value === 'system' ? systemDunkel.value : modus.value === 'dunkel',
  )

  function anwenden() {
    if (!import.meta.client) return
    document.documentElement.classList.toggle('dunkel', istDunkel.value)
    document.documentElement.dataset.palette = design.value
    localStorage.setItem('saru.farbmodus', modus.value)
    localStorage.setItem('saru.farbdesign', design.value)
  }

  function initialisieren() {
    if (!import.meta.client) return
    const abfrage = window.matchMedia('(prefers-color-scheme: dark)')
    systemDunkel.value = abfrage.matches
    abfrage.addEventListener('change', (e) => {
      systemDunkel.value = e.matches
    })

    const gespeicherterModus = localStorage.getItem('saru.farbmodus') as Farbmodus | null
    const gespeichertesDesign = localStorage.getItem('saru.farbdesign') as FarbdesignId | null
    if (gespeicherterModus) modus.value = gespeicherterModus
    if (gespeichertesDesign && FARBDESIGNS.some((d) => d.id === gespeichertesDesign)) {
      design.value = gespeichertesDesign
    }
    anwenden()

    watch(istDunkel, () => anwenden())
  }

  async function setzen(neu: { modus?: Farbmodus; design?: FarbdesignId }, speichern = true) {
    if (neu.modus) modus.value = neu.modus
    if (neu.design) design.value = neu.design
    anwenden()

    if (speichern) {
      // Fehler hier dürfen die Anzeige nicht stören – die Auswahl gilt lokal ohnehin.
      await $fetch('/api/auth/preferences', {
        method: 'PATCH',
        body: { theme: modus.value, palette: design.value },
      }).catch(() => undefined)
    }
  }

  return { modus, design, istDunkel, setzen, initialisieren, anwenden }
}
