import Sortable from 'sortablejs'

export interface SortierOptionen {
  /** CSS-Auswahl des Anfassers; ohne Angabe ist das gesamte Element ziehbar. */
  griff?: string
  /** Wird mit der neuen Reihenfolge der `data-id`-Werte aufgerufen. */
  beiUmsortierung: (ids: string[]) => void | Promise<void>
  deaktiviert?: MaybeRefOrGetter<boolean>
}

/**
 * Macht eine Liste per Ziehen sortierbar. Die Elemente müssen ein
 * `data-id`-Attribut tragen; daraus entsteht die neue Reihenfolge.
 */
export function useSortierbar(behaelter: Ref<HTMLElement | null>, optionen: SortierOptionen) {
  let instanz: Sortable | null = null

  function reihenfolgeLesen(): string[] {
    if (!behaelter.value) return []
    return Array.from(behaelter.value.querySelectorAll<HTMLElement>('[data-id]'))
      .map((el) => el.dataset.id)
      .filter((id): id is string => Boolean(id))
  }

  function aufbauen() {
    if (!behaelter.value || instanz) return
    instanz = Sortable.create(behaelter.value, {
      animation: 180,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      handle: optionen.griff,
      ghostClass: 'sortier-geist',
      chosenClass: 'sortier-aktiv',
      // Auf Touchgeräten erst nach kurzem Halten ziehen, damit Scrollen möglich bleibt.
      delay: 120,
      delayOnTouchOnly: true,
      onEnd: (event) => {
        if (event.oldIndex === event.newIndex) return
        void optionen.beiUmsortierung(reihenfolgeLesen())
      },
    })
  }

  function abbauen() {
    instanz?.destroy()
    instanz = null
  }

  onMounted(() => {
    if (!toValue(optionen.deaktiviert)) aufbauen()
  })

  watch(
    () => toValue(optionen.deaktiviert),
    (aus) => (aus ? abbauen() : aufbauen()),
  )

  watch(behaelter, (el) => {
    abbauen()
    if (el && !toValue(optionen.deaktiviert)) aufbauen()
  })

  onBeforeUnmount(abbauen)

  return { reihenfolgeLesen }
}
