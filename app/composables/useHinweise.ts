export type HinweisArt = 'erfolg' | 'fehler' | 'warnung' | 'info'

export interface Hinweis {
  id: number
  art: HinweisArt
  text: string
  /** Optionale Rückgängig-Aktion, z. B. nach dem Archivieren. */
  aktion?: { text: string; ausfuehren: () => void | Promise<void> }
}

let naechsteId = 1

/** Kurzlebige Rückmeldungen am unteren Bildschirmrand. */
export function useHinweise() {
  const liste = useState<Hinweis[]>('hinweise', () => [])

  function zeigen(art: HinweisArt, text: string, aktion?: Hinweis['aktion'], dauerMs = 5000) {
    const id = naechsteId++
    liste.value = [...liste.value, { id, art, text, aktion }]
    if (import.meta.client) {
      // Meldungen mit Aktion bleiben länger stehen, damit man sie nutzen kann.
      setTimeout(() => schliessen(id), aktion ? Math.max(dauerMs, 9000) : dauerMs)
    }
    return id
  }

  function schliessen(id: number) {
    liste.value = liste.value.filter((h) => h.id !== id)
  }

  return {
    liste: readonly(liste),
    schliessen,
    erfolg: (text: string, aktion?: Hinweis['aktion']) => zeigen('erfolg', text, aktion),
    fehler: (text: string) => zeigen('fehler', text, undefined, 8000),
    warnung: (text: string) => zeigen('warnung', text, undefined, 7000),
    info: (text: string, aktion?: Hinweis['aktion']) => zeigen('info', text, aktion),
  }
}
