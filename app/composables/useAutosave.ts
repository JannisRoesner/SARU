export type SpeicherZustand = 'unveraendert' | 'geaendert' | 'speichert' | 'gespeichert' | 'fehler'

export interface AutosaveOptionen<T> {
  /** Wartezeit nach der letzten Änderung, bevor gespeichert wird. */
  verzoegerungMs?: number
  /** Wird mit den geänderten Daten aufgerufen. */
  speichern: (daten: T) => Promise<unknown>
  /** Solange dies `false` liefert, wird nicht gespeichert (z. B. Pflichtfelder leer). */
  gueltig?: (daten: T) => boolean
}

/**
 * Speichert Formularänderungen automatisch nach kurzer Pause.
 *
 * Beim Verlassen der Seite wird eine noch ausstehende Änderung sofort
 * geschrieben, damit nichts verloren geht.
 */
export function useAutosave<T extends object>(quelle: Ref<T>, optionen: AutosaveOptionen<T>) {
  const { verzoegerungMs = 1200, speichern, gueltig } = optionen

  const zustand = ref<SpeicherZustand>('unveraendert')
  const letzterFehler = ref<string | null>(null)
  const zuletztGespeichert = ref<Date | null>(null)

  let zeitgeber: ReturnType<typeof setTimeout> | undefined
  let aktiv = false
  let erneutPruefen = false

  async function jetztSpeichern() {
    if (zeitgeber) {
      clearTimeout(zeitgeber)
      zeitgeber = undefined
    }
    if (zustand.value !== 'geaendert' && zustand.value !== 'fehler') return

    // Ein laufender Speichervorgang wird nicht unterbrochen; stattdessen läuft
    // danach ein weiterer Durchgang mit dem aktuellen Stand.
    if (aktiv) {
      erneutPruefen = true
      return
    }

    const daten = toRaw(quelle.value)
    if (gueltig && !gueltig(daten)) return

    aktiv = true
    zustand.value = 'speichert'
    try {
      await speichern(daten)
      zuletztGespeichert.value = new Date()
      letzterFehler.value = null
      zustand.value = 'gespeichert'
    } catch (error) {
      letzterFehler.value = toApiFehler(error).nachricht
      zustand.value = 'fehler'
    } finally {
      aktiv = false
      if (erneutPruefen) {
        erneutPruefen = false
        zustand.value = 'geaendert'
        void jetztSpeichern()
      }
    }
  }

  const beobachter = watch(
    quelle,
    () => {
      zustand.value = 'geaendert'
      if (zeitgeber) clearTimeout(zeitgeber)
      zeitgeber = setTimeout(() => void jetztSpeichern(), verzoegerungMs)
    },
    { deep: true },
  )

  /** Änderungen übernehmen, ohne ein Speichern auszulösen (z. B. nach dem Laden). */
  function alsGespeichertMarkieren() {
    if (zeitgeber) clearTimeout(zeitgeber)
    nextTick(() => {
      zustand.value = 'unveraendert'
    })
  }

  onBeforeUnmount(() => {
    beobachter()
    void jetztSpeichern()
  })

  if (import.meta.client) {
    useEventListener(window, 'beforeunload', (event: BeforeUnloadEvent) => {
      if (zustand.value === 'geaendert' || zustand.value === 'speichert') {
        event.preventDefault()
        event.returnValue = ''
      }
    })
  }

  return { zustand, letzterFehler, zuletztGespeichert, jetztSpeichern, alsGespeichertMarkieren }
}

/** Kleiner Helfer, damit Ereignisse beim Verlassen der Seite sauber abgemeldet werden. */
export function useEventListener<K extends keyof WindowEventMap>(
  ziel: Window,
  typ: K,
  handler: (event: WindowEventMap[K]) => void,
) {
  onMounted(() => ziel.addEventListener(typ, handler))
  onBeforeUnmount(() => ziel.removeEventListener(typ, handler))
}
