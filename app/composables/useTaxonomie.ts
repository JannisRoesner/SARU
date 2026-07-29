export interface Fach {
  id: string
  name: string
  shortName: string | null
  color: string
  sortOrder: number
}

export interface Lerngruppe {
  id: string
  name: string
  gradeLevel: number | null
  schoolYear: string | null
  schoolForm: string | null
  subjectId: string | null
}

export interface Thema {
  id: string
  name: string
  parentId: string | null
  subjectId: string | null
}

export interface Schlagwort {
  id: string
  name: string
  color: string | null
}

export interface Kompetenz {
  id: string
  name: string
  area: string | null
  code: string | null
  subjectId: string | null
}

export interface Taxonomie {
  subjects: Fach[]
  learningGroups: Lerngruppe[]
  topics: Thema[]
  tags: Schlagwort[]
  competencies: Kompetenz[]
}

const LEER: Taxonomie = {
  subjects: [],
  learningGroups: [],
  topics: [],
  tags: [],
  competencies: [],
}

/**
 * Die Auswahllisten werden fast überall gebraucht und ändern sich selten,
 * deshalb hält sie ein geteilter Zustand für die ganze Sitzung vor.
 */
export function useTaxonomie() {
  const { data, status, refresh } = useFetch<Taxonomie>('/api/taxonomy', {
    key: 'taxonomie',
    default: () => LEER,
    getCachedData: (key, nuxtApp) => nuxtApp.payload.data[key] ?? nuxtApp.static.data[key],
  })

  const faecher = computed(() => data.value?.subjects ?? [])
  const lerngruppen = computed(() => data.value?.learningGroups ?? [])
  const themen = computed(() => data.value?.topics ?? [])
  const schlagwoerter = computed(() => data.value?.tags ?? [])
  const kompetenzen = computed(() => data.value?.competencies ?? [])

  const fachOptionen = computed(() =>
    faecher.value.map((f) => ({ value: f.id, label: f.name })),
  )
  const lerngruppenOptionen = computed(() =>
    lerngruppen.value.map((g) => ({
      value: g.id,
      label: g.schoolYear ? `${g.name} (${g.schoolYear})` : g.name,
    })),
  )
  const themenOptionen = computed(() => {
    const nachId = new Map(themen.value.map((t) => [t.id, t]))
    return themen.value.map((t) => {
      const eltern = t.parentId ? nachId.get(t.parentId) : undefined
      return { value: t.id, label: eltern ? `${eltern.name} › ${t.name}` : t.name }
    })
  })
  const schlagwortNamen = computed(() => schlagwoerter.value.map((s) => s.name))
  const fachNamen = computed(() => faecher.value.map((f) => f.name))

  function fach(id: string | null | undefined) {
    return id ? faecher.value.find((f) => f.id === id) : undefined
  }

  return {
    taxonomie: data,
    laedt: computed(() => status.value === 'pending'),
    aktualisieren: refresh,
    faecher,
    lerngruppen,
    themen,
    schlagwoerter,
    kompetenzen,
    fachOptionen,
    lerngruppenOptionen,
    themenOptionen,
    schlagwortNamen,
    fachNamen,
    fach,
  }
}
