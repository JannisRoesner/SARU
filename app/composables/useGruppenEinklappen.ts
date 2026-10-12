/**
 * Ein-/Ausklappen von Kategorien einer Liste (Lehrwerk-Inhalt, auch im Freigabe-Link).
 * Der Zustand wird pro Schlüssel im Browser gemerkt; bei aktiver Suche bleiben Treffer sichtbar.
 */
export function useGruppenEinklappen(
  speicherKey: MaybeRefOrGetter<string>,
  gruppenIds: MaybeRefOrGetter<string[]>,
  suchtGerade: MaybeRefOrGetter<boolean>,
) {
  const zugeklappt = ref<string[]>([])

  onMounted(() => {
    try {
      const roh = localStorage.getItem(toValue(speicherKey))
      if (roh) zugeklappt.value = JSON.parse(roh) as string[]
    } catch {
      // Ohne localStorage starten alle Kategorien offen.
    }
  })

  function merken() {
    try {
      localStorage.setItem(toValue(speicherKey), JSON.stringify(zugeklappt.value))
    } catch {
      // Merken ist nur Komfort.
    }
  }

  function offen(gruppeId: string) {
    return toValue(suchtGerade) || !zugeklappt.value.includes(gruppeId)
  }

  function umschalten(gruppeId: string) {
    zugeklappt.value = zugeklappt.value.includes(gruppeId)
      ? zugeklappt.value.filter((g) => g !== gruppeId)
      : [...zugeklappt.value, gruppeId]
    merken()
  }

  const alleZugeklappt = computed(() => {
    const ids = toValue(gruppenIds)
    return ids.length > 0 && ids.every((g) => zugeklappt.value.includes(g))
  })

  function alleUmschalten() {
    zugeklappt.value = alleZugeklappt.value ? [] : [...toValue(gruppenIds)]
    merken()
  }

  return { offen, umschalten, alleZugeklappt, alleUmschalten }
}
