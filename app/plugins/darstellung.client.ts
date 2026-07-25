/** Setzt Farbmodus und Farbdesign, sobald die Anwendung im Browser startet. */
export default defineNuxtPlugin(() => {
  const { initialisieren, setzen } = useDarstellung()
  const { benutzer } = useSitzung()

  initialisieren()

  // Die am Konto hinterlegte Auswahl hat Vorrang, sobald die Sitzung geladen ist.
  watch(
    benutzer,
    (aktuell) => {
      if (!aktuell) return
      const prefs = aktuell.preferences as { farbmodus?: Farbmodus; farbdesign?: FarbdesignId }
      if (prefs?.farbmodus || prefs?.farbdesign) {
        void setzen({ modus: prefs.farbmodus, design: prefs.farbdesign }, false)
      }
    },
    { immediate: true },
  )
})
