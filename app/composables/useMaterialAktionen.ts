/**
 * Aktionen, die an mehreren Stellen auf einem Material ausgeführt werden
 * (Liste, Detailansicht, Suchergebnis). `nachAenderung` erlaubt es der
 * jeweiligen Ansicht, ihre Daten neu zu laden.
 */
export function useMaterialAktionen(nachAenderung?: () => unknown) {
  const { aufruf, laeuft } = useApi()
  const hinweise = useHinweise()

  async function fertig() {
    await nachAenderung?.()
  }

  async function favoritSetzen(id: string, wert: boolean) {
    const ergebnis = await aufruf(`/api/materials/${id}/favorite`, {
      method: 'PATCH',
      body: { isFavorite: wert },
    })
    if (ergebnis) await fertig()
  }

  async function bewerten(id: string, rating: number | null) {
    const ergebnis = await aufruf(`/api/materials/${id}/rating`, {
      method: 'PATCH',
      body: { rating },
    })
    if (ergebnis) await fertig()
  }

  async function archivieren(id: string, wert: boolean) {
    const ergebnis = await aufruf(`/api/materials/${id}/archive`, {
      method: 'PATCH',
      body: { isArchived: wert },
      erfolgsmeldung: wert ? 'Material archiviert.' : 'Material wiederhergestellt.',
    })
    if (ergebnis) await fertig()
  }

  async function duplizieren(id: string) {
    const ergebnis = await aufruf<{ id: string }>(`/api/materials/${id}/duplicate`, {
      method: 'POST',
    })
    if (!ergebnis) return null
    hinweise.erfolg('Kopie angelegt.', {
      text: 'Öffnen',
      ausfuehren: () => {
        void navigateTo(`/materialien/${ergebnis.id}`)
      },
    })
    await fertig()
    return ergebnis.id
  }

  async function loeschen(id: string) {
    const ergebnis = await aufruf(`/api/materials/${id}`, {
      method: 'DELETE',
      erfolgsmeldung: 'Material gelöscht.',
    })
    if (ergebnis !== null) await fertig()
    return ergebnis !== null
  }

  /** Setzt „zuletzt verwendet“, etwa beim Öffnen eines Anhangs. */
  function alsVerwendetMerken(id: string) {
    return $fetch(`/api/materials/${id}/used`, { method: 'POST' }).catch(() => undefined)
  }

  return {
    laeuft,
    favoritSetzen,
    bewerten,
    archivieren,
    duplizieren,
    loeschen,
    alsVerwendetMerken,
  }
}
