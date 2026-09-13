const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function materialUuid(wert: unknown): string | null {
  const roh = Array.isArray(wert) ? wert[0] : wert
  return typeof roh === 'string' && UUID.test(roh) ? roh : null
}

/** Detailroute: Lehrwerke haben eine eigene Hub-Ansicht. */
export function materialPfad(
  material: { id: string; materialType?: string | null },
  optionen?: { lehrwerkId?: string | null },
): string {
  if (material.materialType === 'lehrwerk') return `/lehrwerke/${material.id}`
  const basis = `/materialien/${material.id}`
  const lehrwerkId = materialUuid(optionen?.lehrwerkId)
  return lehrwerkId ? `${basis}?lehrwerk=${lehrwerkId}` : basis
}

export type MaterialZurueckRelation = {
  relationType: string
  direction: string
  material: { id: string; title: string; materialType: string }
}

/**
 * Zurück-Ziel auf der Materialdetailseite.
 * Gehört das Material zu einem Lehrwerk, führt der Link dorthin — nicht zur Materialliste.
 */
export function materialZurueckZiel(input: {
  materialType?: string | null
  relations?: MaterialZurueckRelation[] | null
  queryLehrwerkId?: unknown
}): { to: string; label: string } {
  if (input.materialType === 'lehrwerk') {
    return { to: '/lehrwerke', label: 'Lehrwerke' }
  }

  const lehrwerke = (input.relations ?? []).filter(
    (relation) =>
      relation.relationType === 'gehoert_zu'
      && relation.direction === 'ausgehend'
      && relation.material.materialType === 'lehrwerk',
  )

  const angefragt = materialUuid(input.queryLehrwerkId)
  const passend = angefragt
    ? lehrwerke.find((relation) => relation.material.id === angefragt)
    : undefined

  if (passend) {
    return { to: `/lehrwerke/${passend.material.id}`, label: 'Lehrwerk' }
  }
  if (angefragt) {
    return { to: `/lehrwerke/${angefragt}`, label: 'Lehrwerk' }
  }
  if (lehrwerke[0]) {
    return { to: `/lehrwerke/${lehrwerke[0].material.id}`, label: 'Lehrwerk' }
  }

  return { to: '/materialien', label: 'Materialien' }
}
