<script setup lang="ts">
import { materialTypes, importStatuses } from '#shared/utils/labels'
import type { GradeLevel } from '#shared/utils/jahrgangsstufen'
import type { MaterialType } from '#shared/types/domain'
import {
  BULK_FILE_ROLE_LABELS,
  BULK_FOLDER_ROLE_LABELS,
  resolveBulkGradeLevels,
  type BulkFileRole,
  type BulkFolderRole,
} from '#shared/utils/bulk-upload'

const route = useRoute()
const runId = computed(() => String(route.params.runId))
const { darfAnlegen } = useSitzung()
const { aufruf, laeuft } = useApi()
const { schlagwortNamen } = useTaxonomie()
const { optionen: schulformOptionen } = useSchulformen()

if (!darfAnlegen.value) await navigateTo('/materialien')

const dateiRollen = (Object.entries(BULK_FILE_ROLE_LABELS) as [BulkFileRole, string][]).map(
  ([value, label]) => ({ value, label }),
)

interface DetectedFile {
  sourceRef: string
  fileName: string
  relativePath?: string | null
  sizeBytes: number
  pageCount: number | null
  hasText: boolean
  textPreview: string | null
  duplicate: { materialId: string; title: string; reason: string } | null
  stagingMissing?: boolean
  warnings: string[]
}

interface AbbildungPlanEintrag {
  ref: string
  dateiName: string
  metadaten: { titel: string | null; seite: string | null; abbildung: string | null; kapitel: string | null }
  varianteVonRef: string | null
  herkunft: 'paket' | 'dateiname'
}

interface DetectedCluster {
  clusterId: string
  kind: 'paar' | 'varianten' | 'einzeln' | 'unklar' | 'abbildungssammlung'
  abbildungen?: {
    ordner: string
    manifestFehler: string[]
    plan: { manifestGefunden: boolean; ohneAngaben: number; varianten: number; eintraege: AbbildungPlanEintrag[] }
  }
  folderRole: BulkFolderRole
  stem: string
  fileRefs: string[]
  suggestedRoles: Record<string, BulkFileRole>
  suggestions: {
    title: string
    materialType: MaterialType
    subjectNames: string[]
    tagNames: string[]
    description: string
    learningObjectives?: string[]
    contentSummary?: string
    aiUsed: boolean
  }
  proposedLinks: Array<{
    targetClusterId: string
    relationType: string
    reason: string
    confidence: 'hoch' | 'mittel'
  }>
  lernzirkel?: { id: string; title: string }
  warnings: string[]
}

interface RunOverview {
  runId: string
  adapterLabel: string
  status: string
  sourceFileName: string
  sourceSizeBytes: number | null
  files: DetectedFile[]
  clusters: DetectedCluster[]
  skippedFiles?: { pfad: string; grund: string }[]
  skippedCount?: number
  mapping: {
    abbildungenKi?: boolean
    subjectId?: string | null
    subjectName?: string
    gradeLevels?: GradeLevel[]
    gradeLevel?: GradeLevel | null
    schoolForm?: string | null
    defaultMaterialType?: MaterialType
    linkDuplicates?: boolean
    createLehrwerk?: boolean
    lehrwerkTitle?: string
    lehrwerkId?: string | null
    lernzirkel?: Record<string, { enabled?: boolean; title?: string }>
    records?: Record<
      string,
      {
        include: boolean
        title?: string
        materialType?: MaterialType
        description?: string
        tagNames?: string[]
        learningObjectives?: string[]
        content?: string
        action?: string
        duplicateOfId?: string | null
        fileRoles?: Record<string, BulkFileRole>
        links?: Record<string, boolean>
        solutionTitle?: string
      }
    >
  } | null
  stats: Record<string, number> | null
  errorMessage: string | null
  aiEnabled: boolean
  analysisPending?: boolean
  canCommit: boolean
  canCancel?: boolean
  canDiscard?: boolean
  canUndo: boolean
  undoneAt: string | null
  clusterOutcomes: Record<string, { outcome: 'erstellt' | 'fehlgeschlagen' | 'uebersprungen'; message: string | null }>
  retryableClusterIds: string[]
  canRetry: boolean
  canDiscardLeftovers: boolean
  kiOhneVorschlag?: number
  kiNachholen?: { fertig: number; gesamt: number } | null
  canKiNachholen?: boolean
}

const { data, status, error, refresh } = await useFetch<RunOverview>(
  () => `/api/materials/bulk/${runId.value}`,
)

useHead({ title: () => (data.value ? `Stapel · ${data.value.sourceFileName}` : 'Stapel-Upload') })

const mapping = reactive({
  subjectId: null as string | null,
  subjectName: '',
  gradeLevels: [] as GradeLevel[],
  schoolForm: null as string | null,
  defaultMaterialType: 'arbeitsblatt' as MaterialType,
  linkDuplicates: true,
  createLehrwerk: false,
  lehrwerkTitle: '',
  lehrwerkId: null as string | null,
  abbildungenKi: false,
  lernzirkel: {} as Record<string, { enabled: boolean; title: string }>,
  records: {} as Record<
    string,
    {
      include: boolean
      title: string
      materialType: MaterialType
      description: string
      tagNames: string[]
      learningObjectives: string[]
      content: string
      action: string
      duplicateOfId: string | null
      fileRoles: Record<string, BulkFileRole>
      links: Record<string, boolean>
      solutionTitle: string
    }
  >,
})

const geladen = ref(false)

const dateiNachRef = computed(() => {
  const map = new Map<string, DetectedFile>()
  for (const file of data.value?.files ?? []) map.set(file.sourceRef, file)
  return map
})

const titelNachCluster = computed(() => {
  const map = new Map<string, string>()
  for (const cluster of data.value?.clusters ?? []) {
    map.set(cluster.clusterId, mapping.records[cluster.clusterId]?.title ?? cluster.suggestions.title)
  }
  return map
})

watch(
  data,
  (wert) => {
    if (!wert?.mapping) return
    const m = wert.mapping
    mapping.subjectId = m.subjectId ?? null
    mapping.subjectName = m.subjectName ?? ''
    mapping.gradeLevels = resolveBulkGradeLevels(m)
    mapping.schoolForm = m.schoolForm ?? null
    mapping.defaultMaterialType = m.defaultMaterialType ?? 'arbeitsblatt'
    mapping.linkDuplicates = m.linkDuplicates ?? true
    mapping.createLehrwerk = m.createLehrwerk ?? false
    mapping.lehrwerkTitle = m.lehrwerkTitle ?? ''
    mapping.lehrwerkId = m.lehrwerkId ?? null
    mapping.abbildungenKi = m.abbildungenKi ?? false

    const records: typeof mapping.records = {}
    for (const cluster of wert.clusters ?? []) {
      const existing = m.records?.[cluster.clusterId] ?? m.records?.[cluster.fileRefs[0] ?? '']
      records[cluster.clusterId] = {
        include: existing?.include ?? true,
        title: existing?.title ?? cluster.suggestions.title,
        materialType: existing?.materialType ?? cluster.suggestions.materialType,
        description: existing?.description ?? cluster.suggestions.description ?? '',
        tagNames: [...(existing?.tagNames ?? cluster.suggestions.tagNames ?? [])],
        learningObjectives: [
          ...(existing?.learningObjectives ?? cluster.suggestions.learningObjectives ?? []),
        ],
        content: existing?.content ?? cluster.suggestions.contentSummary ?? '',
        action: existing?.action ?? 'erstellen',
        duplicateOfId: existing?.duplicateOfId ?? null,
        fileRoles: { ...cluster.suggestedRoles, ...(existing?.fileRoles ?? {}) },
        links: {
          ...Object.fromEntries(cluster.proposedLinks.map((link) => [link.targetClusterId, link.confidence === 'hoch'])),
          ...(existing?.links ?? {}),
        },
        solutionTitle: existing?.solutionTitle ?? '',
      }
    }
    mapping.records = records

    const lernzirkel: typeof mapping.lernzirkel = {}
    for (const cluster of wert.clusters ?? []) {
      const ref = cluster.lernzirkel
      if (!ref || lernzirkel[ref.id]) continue
      const gespeichert = m.lernzirkel?.[ref.id]
      lernzirkel[ref.id] = {
        enabled: gespeichert?.enabled ?? true,
        title: gespeichert?.title ?? ref.title,
      }
    }
    mapping.lernzirkel = lernzirkel
    nextTick(() => {
      geladen.value = true
      autosave.alsGespeichertMarkieren()
    })
  },
  { immediate: true },
)

const autosave = useAutosave(mapping, {
  gueltig: () => geladen.value && Boolean(data.value?.canCommit || data.value?.canRetry),
  speichern: async (daten) => {
    await $fetch(`/api/materials/bulk/${runId.value}/mapping`, {
      method: 'PATCH',
      body: { ...daten, gradeLevels: daten.gradeLevels },
    })
  },
})

const analyseLaeuft = computed(() => Boolean(data.value?.analysisPending))
const kiNachholenLaeuft = computed(() => Boolean(data.value?.kiNachholen))

async function kiNachholen() {
  // Offene Änderungen zuerst sichern – während des Nachholens ist die Zuordnung gesperrt.
  await autosave.jetztSpeichern()
  if (autosave.zustand.value === 'fehler') return
  const ergebnis = await aufruf<{ gesamt: number }>(`/api/materials/bulk/${runId.value}/ki-nachholen`, {
    method: 'POST',
  })
  if (ergebnis) await refresh()
}

const schritt = computed(() => {
  const s = data.value?.status
  if (!s || analyseLaeuft.value) return 1
  if (['importiert', 'teilweise_importiert', 'fehlgeschlagen', 'rueckgaengig'].includes(s)) return 4
  if (s === 'laeuft') return 3
  return 2
})

const sammlungen = computed(() => (data.value?.clusters ?? []).filter((c) => c.kind === 'abbildungssammlung'))
const bilderOhneAngaben = computed(() =>
  sammlungen.value.reduce((summe, c) => summe + (c.abbildungen?.plan.ohneAngaben ?? 0), 0),
)

/** Vorschau der Bilder einer Sammlung – lange Listen nur auf Wunsch ganz. */
const MAX_BILDER_VORSCHAU = 30
const alleBilderOffen = ref(new Set<string>())

function clusterMaterialzahl(clusterId: string): number {
  const record = mapping.records[clusterId]
  if (!record?.include) return 0
  if (clusterId.startsWith('abbildungen:')) return 1
  const roles = Object.values(record.fileRoles)
  const hatPrimaer = roles.some(
    (role) => role === 'schueler' || role === 'einzeln' || role === 'abbildung',
  )
  const hatLoesung = roles.includes('loesung')
  return (hatPrimaer ? 1 : 0) + (hatLoesung ? 1 : 0)
}

const ausgewaehlt = computed(
  () => Object.values(mapping.records).filter((r) => r.include).length,
)

const nachholbar = computed(() => new Set(data.value?.retryableClusterIds ?? []))

/** Vor dem Anlegen alle Bündel; bei teilweiser Übernahme nur die noch nicht angelegten. */
function bearbeitbar(clusterId: string): boolean {
  if (data.value?.canCommit) return true
  return Boolean(data.value?.canRetry) && nachholbar.value.has(clusterId)
}

/** Ausgewählte, noch nicht angelegte Bündel bei teilweiser Übernahme. */
const nachzuholen = computed(
  () => [...nachholbar.value].filter((id) => mapping.records[id]?.include).length,
)

const ergebnisLabels = {
  erstellt: { label: 'Angelegt', ton: 'gruen', icon: 'circle-check' },
  fehlgeschlagen: { label: 'Fehlgeschlagen', ton: 'rot', icon: 'circle-xmark' },
  uebersprungen: { label: 'Übersprungen', ton: 'neutral', icon: 'forward' },
} as const

/** Erkannte Lernzirkel mit der Zahl ihrer ausgewählten Stationen. */
const lernzirkelListe = computed(() => {
  const nachId = new Map<string, { id: string; stationen: number; ausgewaehlt: number }>()
  for (const cluster of data.value?.clusters ?? []) {
    const ref = cluster.lernzirkel
    if (!ref) continue
    const eintrag = nachId.get(ref.id) ?? { id: ref.id, stationen: 0, ausgewaehlt: 0 }
    eintrag.stationen += 1
    if (mapping.records[cluster.clusterId]?.include) eintrag.ausgewaehlt += 1
    nachId.set(ref.id, eintrag)
  }
  return [...nachId.values()]
})

const materialzahl = computed(() => {
  let n = Object.keys(mapping.records).reduce((sum, id) => sum + clusterMaterialzahl(id), 0)
  n += lernzirkelListe.value.filter(
    (zirkel) => mapping.lernzirkel[zirkel.id]?.enabled && zirkel.ausgewaehlt >= 2,
  ).length
  if (
    mapping.createLehrwerk
    && ausgewaehlt.value
    && !mapping.lehrwerkId
    && mapping.lehrwerkTitle.trim()
  ) {
    n += 1
  }
  return n
})

const gruppen = computed(() => {
  const clusters = data.value?.clusters ?? []
  const order: BulkFolderRole[] = [
    'kopiervorlagen',
    'klausuren',
    'versuche',
    'gefaehrdungsbeurteilung',
    'abbildungen',
    'lernzirkel',
    'sonstiges',
  ]
  return order
    .map((role) => ({
      role,
      label: BULK_FOLDER_ROLE_LABELS[role],
      clusters: clusters.filter((cluster) =>
        role === 'sonstiges'
          ? cluster.folderRole === 'sonstiges' || cluster.kind === 'unklar'
          : cluster.folderRole === role && cluster.kind !== 'unklar',
      ),
    }))
    .filter((gruppe) => gruppe.clusters.length)
})

async function committen() {
  const nachholen = Boolean(data.value?.canRetry)
  await autosave.jetztSpeichern()
  if (autosave.zustand.value === 'fehler') return
  const ergebnis = await aufruf(`/api/materials/bulk/${runId.value}/commit`, {
    method: 'POST',
    erfolgsmeldung: nachholen ? 'Bündel erneut angelegt.' : 'Materialien angelegt.',
  })
  if (ergebnis) await refresh()
}

const abbrechenOffen = ref(false)
const verwerfenOffen = ref(false)
const rueckgaengigOffen = ref(false)
const resteVerwerfenOffen = ref(false)

async function resteVerwerfen() {
  const ok = await aufruf(`/api/materials/bulk/${runId.value}/leftovers`, {
    method: 'DELETE',
    erfolgsmeldung: 'Übrige Dateien verworfen.',
  })
  resteVerwerfenOffen.value = false
  if (ok) await refresh()
}

async function analyseAbbrechen() {
  const ok = await aufruf(`/api/materials/bulk/${runId.value}/cancel`, {
    method: 'POST',
    erfolgsmeldung: 'Analyse abgebrochen.',
  })
  abbrechenOffen.value = false
  if (ok) await refresh()
}

async function verwerfen() {
  const ok = await aufruf(`/api/materials/bulk/${runId.value}`, {
    method: 'DELETE',
    erfolgsmeldung: 'Stapel verworfen.',
  })
  verwerfenOffen.value = false
  if (ok) await navigateTo('/import/stapel')
}

async function rueckgaengig() {
  const ok = await aufruf(`/api/materials/bulk/${runId.value}/undo`, {
    method: 'POST',
    erfolgsmeldung: 'Stapel rückgängig gemacht. Die Vorschau ist wieder bearbeitbar.',
  })
  rueckgaengigOffen.value = false
  if (ok) await refresh()
}

const { data: protokoll, refresh: logsLaden } = await useFetch<{
  logs: { id: string; level: string; message: string; createdAt: string }[]
}>(() => `/api/imports/${runId.value}/logs`, {
  default: () => ({ logs: [] }),
})

const logs = computed(() => protokoll.value?.logs ?? [])

watch(
  () => data.value?.status,
  () => void logsLaden(),
)

let analysePoll: ReturnType<typeof setInterval> | undefined
watch(
  () => analyseLaeuft.value || kiNachholenLaeuft.value,
  (an) => {
    if (analysePoll) {
      clearInterval(analysePoll)
      analysePoll = undefined
    }
    if (!an) return
    analysePoll = setInterval(() => {
      void refresh()
      void logsLaden()
    }, 2000)
  },
  { immediate: true },
)
onUnmounted(() => {
  if (analysePoll) clearInterval(analysePoll)
})

function alleWaehlen(wert: boolean) {
  for (const key of Object.keys(mapping.records)) {
    mapping.records[key]!.include = wert
  }
}

function rolleUeberspringen(role: BulkFolderRole, wert: boolean) {
  for (const cluster of data.value?.clusters ?? []) {
    if (cluster.folderRole !== role) continue
    if (mapping.records[cluster.clusterId]) mapping.records[cluster.clusterId]!.include = wert
  }
}

function hatLoesung(clusterId: string): boolean {
  return Object.values(mapping.records[clusterId]?.fileRoles ?? {}).includes('loesung')
}
</script>

<template>
  <div>
    <div class="mb-2">
      <NuxtLink
        to="/import/stapel"
        class="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary"
      >
        <UiIcon name="arrow-left" fest /> Alle Stapel
      </NuxtLink>
    </div>

    <UiFehlerzustand v-if="error" :text="toApiFehler(error).nachricht" @erneut="refresh()" />
    <UiSkelett v-else-if="status === 'pending' || !data" art="liste" :zeilen="6" />

    <template v-else>
      <header class="mb-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div class="min-w-0">
          <p class="seitenkopf-kicker">Stapel-Assistent</p>
          <h1 class="break-words text-3xl tracking-tight text-ink">{{ data.sourceFileName }}</h1>
          <div class="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <UiBadge
              :ton="importStatuses.tone(data.status as never)"
              :icon="importStatuses.icon(data.status as never)"
            >
              {{ importStatuses.label(data.status as never) }}
            </UiBadge>
            <span>{{ data.adapterLabel }}</span>
            <span v-if="data.sourceSizeBytes">{{ formatBytes(data.sourceSizeBytes) }}</span>
            <span>{{ data.clusters.length }} Bündel · {{ data.files.length }} Dateien</span>
            <span v-if="data.aiEnabled">KI-Vorschläge</span>
            <span v-else>ohne KI</span>
          </div>
        </div>
        <LayoutAktionen class="sm:ml-auto sm:justify-end" stapeln>
          <UiButton
            v-if="data.canCommit"
            variante="primaer"
            icon="check"
            :laedt="laeuft"
            :disabled="!ausgewaehlt"
            @click="committen"
          >
            {{ materialzahl }} Materialien anlegen
          </UiButton>
          <UiButton
            v-if="data.canKiNachholen"
            variante="sekundaer"
            icon="wand-magic-sparkles"
            :laedt="laeuft"
            @click="kiNachholen"
          >
            KI-Vorschläge nachholen ({{ data.kiOhneVorschlag }})
          </UiButton>
          <UiButton
            v-if="data.canRetry"
            variante="primaer"
            icon="rotate-right"
            :laedt="laeuft"
            :disabled="!nachzuholen"
            @click="committen"
          >
            Fehlgeschlagene erneut anlegen ({{ nachzuholen }})
          </UiButton>
          <UiButton
            v-if="data.canUndo"
            variante="sekundaer"
            icon="rotate-left"
            :laedt="laeuft"
            @click="rueckgaengigOffen = true"
          >
            Rückgängig
          </UiButton>
          <UiButton
            v-if="data.canDiscardLeftovers"
            variante="still"
            icon="trash"
            :laedt="laeuft"
            @click="resteVerwerfenOffen = true"
          >
            Übrige Dateien verwerfen
          </UiButton>
          <UiButton
            v-if="data.canCancel"
            variante="sekundaer"
            icon="xmark"
            :laedt="laeuft"
            @click="abbrechenOffen = true"
          >
            Analyse abbrechen
          </UiButton>
          <UiButton
            v-if="data.canDiscard"
            variante="still"
            icon="trash"
            :laedt="laeuft"
            @click="verwerfenOffen = true"
          >
            Verwerfen
          </UiButton>
          <UiButton
            v-if="data.mapping?.lehrwerkId"
            :to="`/lehrwerke/${data.mapping.lehrwerkId}`"
            variante="sekundaer"
            icon="book"
          >
            Zum Lehrwerk
          </UiButton>
          <UiButton
            v-if="data.status === 'importiert' || data.status === 'teilweise_importiert'"
            to="/materialien"
            variante="still"
            icon="folder-open"
          >
            Zur Sammlung
          </UiButton>
        </LayoutAktionen>
      </header>

      <ol class="mb-8 grid gap-2 sm:grid-cols-4">
        <li
          v-for="(label, i) in ['Upload', 'Zuordnung', 'Anlegen', 'Ergebnis']"
          :key="label"
          class="rounded-xl border px-3 py-2 text-sm"
          :class="schritt >= i + 1 ? 'border-primary/30 bg-primary-soft text-primary-strong' : 'border-line text-ink-subtle'"
        >
          <span class="font-semibold">{{ i + 1 }}.</span> {{ label }}
        </li>
      </ol>

      <p v-if="data.errorMessage" class="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
        {{ data.errorMessage }}
      </p>
      <p
        v-if="data.undoneAt && data.canCommit"
        class="mb-4 rounded-lg bg-surface-sunken px-4 py-3 text-sm text-ink-muted"
      >
        Am {{ formatDatumZeit(data.undoneAt) }} rückgängig gemacht. Dateien, KI-Vorschläge und Entscheidungen
        sind erhalten – nach dem Korrigieren lässt sich der Stapel erneut anlegen.
      </p>
      <p
        v-else-if="data.status === 'rueckgaengig'"
        class="mb-4 rounded-lg bg-surface-sunken px-4 py-3 text-sm text-ink-muted"
      >
        Dieser Stapel wurde rückgängig gemacht, bevor dabei die Dateien aufbewahrt wurden. Zum erneuten Anlegen
        bitte neu hochladen; der Eintrag lässt sich verwerfen.
      </p>
      <p
        v-else-if="data.canRetry"
        class="mb-4 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning"
      >
        {{ data.retryableClusterIds.length }} Bündel wurden noch nicht angelegt. Sie lassen sich unten korrigieren
        und erneut anlegen – Lehrwerk, Lernzirkel und angelegte Materialien bleiben bestehen.
      </p>

      <UiCard v-if="data.kiNachholen" titel="KI-Vorschläge werden nachgeholt" icon="spinner" class="mb-6">
        <p class="text-sm text-ink-muted">
          {{ data.kiNachholen.fertig }} von {{ data.kiNachholen.gesamt }} Bündeln bearbeitet. Bis zum Ende sind
          Zuordnung und Anlegen gesperrt; eigene Änderungen an Titeln und Beschreibungen bleiben erhalten.
        </p>
        <div
          class="mt-3 h-2 overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          :aria-valuenow="data.kiNachholen.fertig"
          aria-valuemin="0"
          :aria-valuemax="data.kiNachholen.gesamt"
        >
          <div
            class="h-full rounded-full bg-[var(--color-primary)] transition-all"
            :style="{ width: `${Math.round((data.kiNachholen.fertig / Math.max(1, data.kiNachholen.gesamt)) * 100)}%` }"
          />
        </div>
      </UiCard>
      <p
        v-else-if="data.canKiNachholen"
        class="mb-4 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning"
      >
        {{ data.kiOhneVorschlag }} Bündel haben keine KI-Vorschläge erhalten und nutzen nur Dateiname und Ordner.
        „KI-Vorschläge nachholen“ fragt sie erneut an.
      </p>

      <UiCard v-if="analyseLaeuft" titel="Analyse läuft" icon="spinner" class="mb-6">
        <p class="text-sm text-ink-muted">
          {{ data.files.length }} Dateien sind angenommen. Texte und KI-Vorschläge werden im Hintergrund erzeugt –
          bei großen Ordnern kann das mehrere Minuten dauern. Diese Seite bleibt offen und aktualisiert sich von selbst.
        </p>
      </UiCard>

      <div v-if="data.stats" class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div v-for="(wert, key) in data.stats" :key="key" class="karte p-3">
          <p class="text-xs uppercase text-ink-subtle">{{ key }}</p>
          <p class="text-lg font-semibold tabular-nums">{{ wert }}</p>
        </div>
      </div>

      <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div class="space-y-5">
          <UiCard v-if="data.canCommit" titel="Gemeinsame Zuordnung" icon="sliders" einklappbar einklapp-id="stapel-run-zuordnung">
            <template #kopf>
              <UiSpeichernAnzeige
                :zustand="autosave.zustand.value"
                :fehler="autosave.letzterFehler.value"
                :zuletzt="autosave.zuletztGespeichert.value"
              />
            </template>
            <div class="grid gap-4 sm:grid-cols-2">
              <UiFachFeld
                v-model:subject-id="mapping.subjectId"
                v-model:subject-name="mapping.subjectName"
                class="sm:col-span-2"
              />
              <UiField label="Jahrgangsstufen" class="sm:col-span-2">
                <UiJahrgangsstufenAuswahl v-model="mapping.gradeLevels" />
              </UiField>
              <UiField label="Schulform">
                <UiSelect
                  v-model="mapping.schoolForm"
                  platzhalter="Optional"
                  :optionen="schulformOptionen.map((o) => ({ value: o.value, label: o.label }))"
                />
              </UiField>
              <UiField label="Standard-Materialart" class="sm:col-span-2">
                <UiSelect
                  v-model="mapping.defaultMaterialType"
                  :optionen="materialTypes.options().map((o) => ({ value: o.value, label: o.label }))"
                />
              </UiField>
              <StapelLehrwerkFeld
                v-model:zuordnen="mapping.createLehrwerk"
                v-model:lehrwerk-id="mapping.lehrwerkId"
                v-model:titel="mapping.lehrwerkTitle"
              />
            </div>
            <UiToggle
              v-if="sammlungen.length && data.aiEnabled"
              v-model="mapping.abbildungenKi"
              class="mt-4"
              label="Fehlende Bildangaben nach dem Anlegen per KI ergänzen"
              :hinweis="`${bilderOhneAngaben} Bilder ohne Titel/Beschreibung aus dem Paket. Läuft im Hintergrund (Vision-Modell, verkleinerte Bilder) und lässt sich in der Sammlung abbrechen oder später starten.`"
            />
            <p class="mt-3 text-xs text-ink-subtle">
              Änderungen werden automatisch gespeichert.
            </p>
          </UiCard>

          <UiCard
            v-if="!analyseLaeuft && data.skippedCount"
            titel="Übersprungene Dateien"
            :untertitel="`${data.skippedCount} Dateien werden nicht übernommen`"
            icon="forward"
            einklappbar
            einklapp-id="stapel-uebersprungen"
            :standard-offen="false"
          >
            <ul class="max-h-80 space-y-1 overflow-y-auto text-xs">
              <li v-for="(eintrag, i) in data.skippedFiles ?? []" :key="i" class="flex flex-wrap gap-x-2">
                <span class="min-w-0 truncate font-medium text-ink">{{ eintrag.pfad }}</span>
                <span class="text-ink-subtle">{{ eintrag.grund }}</span>
              </li>
            </ul>
            <p v-if="(data.skippedFiles?.length ?? 0) < data.skippedCount" class="mt-2 text-xs text-ink-subtle">
              … und {{ data.skippedCount - (data.skippedFiles?.length ?? 0) }} weitere.
            </p>
          </UiCard>

          <UiCard v-if="!analyseLaeuft" titel="Vorschau &amp; Prüfung" icon="eye" einklappbar einklapp-id="stapel-vorschau">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p class="text-sm text-ink-muted">
                {{ data.clusters.length }} Bündel · {{ ausgewaehlt }} ausgewählt · {{ materialzahl }} Materialien
              </p>
              <div v-if="data.canCommit" class="flex flex-wrap gap-2 text-xs">
                <button type="button" class="text-primary hover:underline" @click="alleWaehlen(true)">
                  Alle
                </button>
                <button type="button" class="text-ink-muted hover:underline" @click="alleWaehlen(false)">
                  Keine
                </button>
                <button
                  type="button"
                  class="text-ink-muted hover:underline"
                  @click="rolleUeberspringen('gefaehrdungsbeurteilung', false)"
                >
                  GFB überspringen
                </button>
              </div>
            </div>

            <section v-if="lernzirkelListe.length" class="mb-6 space-y-3">
              <h3 class="text-sm font-semibold text-ink">
                Lernzirkel
                <span class="font-normal text-ink-subtle">· {{ lernzirkelListe.length }}</span>
              </h3>
              <p class="text-xs text-ink-muted">
                Stationenarbeit erkannt: Die Blätter werden einem eigenen Lernzirkel-Material zugeordnet,
                und nur dieses hängt am Lehrwerk. Die Blätter bleiben einzeln auffindbar.
              </p>
              <div
                v-for="zirkel in lernzirkelListe"
                :key="zirkel.id"
                class="rounded-xl border border-line p-3"
              >
                <div v-if="mapping.lernzirkel[zirkel.id]" class="flex flex-wrap items-start gap-3">
                  <label v-if="data.canCommit" class="mt-2">
                    <input
                      v-model="mapping.lernzirkel[zirkel.id]!.enabled"
                      type="checkbox"
                      class="accent-[var(--color-primary)]"
                    >
                  </label>
                  <div class="min-w-0 flex-1 space-y-2">
                    <UiField v-if="data.canCommit" label="Titel des Lernzirkels">
                      <UiInput
                        v-model="mapping.lernzirkel[zirkel.id]!.title"
                        :disabled="!mapping.lernzirkel[zirkel.id]!.enabled"
                      />
                    </UiField>
                    <p v-else class="font-medium text-ink">{{ mapping.lernzirkel[zirkel.id]!.title }}</p>
                    <p class="text-xs text-ink-subtle">
                      {{ zirkel.ausgewaehlt }} von {{ zirkel.stationen }} Bündeln ausgewählt ·
                      <template v-if="mapping.lernzirkel[zirkel.id]!.enabled">
                        als Lernzirkel zusammengefasst
                      </template>
                      <template v-else>nicht zusammengefasst – Blätter hängen einzeln am Lehrwerk</template>
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <div class="space-y-6">
              <section v-for="gruppe in gruppen" :key="gruppe.role">
                <h3 class="mb-2 text-sm font-semibold text-ink">
                  {{ gruppe.label }}
                  <span class="font-normal text-ink-subtle">· {{ gruppe.clusters.length }}</span>
                </h3>
                <ul class="space-y-3">
                  <li
                    v-for="cluster in gruppe.clusters"
                    :key="cluster.clusterId"
                    class="rounded-xl border border-line p-3"
                  >
                    <div class="flex flex-wrap items-start gap-3">
                      <label v-if="bearbeitbar(cluster.clusterId) && mapping.records[cluster.clusterId]" class="mt-2">
                        <input
                          v-model="mapping.records[cluster.clusterId]!.include"
                          type="checkbox"
                          class="accent-[var(--color-primary)]"
                        >
                      </label>
                      <div class="min-w-0 flex-1 space-y-3">
                        <div>
                          <p class="text-xs text-ink-subtle">
                            {{
                              cluster.kind === 'abbildungssammlung'
                                ? 'Abbildungssammlung'
                                : cluster.kind === 'paar'
                                  ? 'Paar'
                                  : cluster.kind === 'varianten'
                                    ? 'Fassungen'
                                    : cluster.kind === 'unklar'
                                      ? 'Bitte prüfen'
                                      : 'Einzeldatei'
                            }}
                            · {{ cluster.fileRefs.length }} Datei{{ cluster.fileRefs.length === 1 ? '' : 'en' }}
                            <template v-if="cluster.suggestions.aiUsed"> · KI</template>
                            <template v-if="cluster.lernzirkel && mapping.lernzirkel[cluster.lernzirkel.id]?.enabled">
                              · Station in „{{ mapping.lernzirkel[cluster.lernzirkel.id]!.title }}“
                            </template>
                          </p>
                          <p v-if="data.clusterOutcomes[cluster.clusterId]" class="mt-1 flex flex-wrap items-center gap-2">
                            <UiBadge
                              :ton="ergebnisLabels[data.clusterOutcomes[cluster.clusterId]!.outcome].ton"
                              :icon="ergebnisLabels[data.clusterOutcomes[cluster.clusterId]!.outcome].icon"
                            >
                              {{ ergebnisLabels[data.clusterOutcomes[cluster.clusterId]!.outcome].label }}
                            </UiBadge>
                            <span
                              v-if="data.clusterOutcomes[cluster.clusterId]!.outcome === 'fehlgeschlagen' && data.clusterOutcomes[cluster.clusterId]!.message"
                              class="text-xs text-danger"
                            >
                              {{ data.clusterOutcomes[cluster.clusterId]!.message }}
                            </span>
                          </p>
                          <div v-if="cluster.abbildungen" class="mt-1 space-y-1 text-xs text-ink-muted">
                            <p>
                              Ordner „{{ cluster.abbildungen.ordner }}“ ·
                              {{ cluster.abbildungen.plan.varianten }} Varianten ·
                              {{ cluster.abbildungen.plan.manifestGefunden ? 'mit abbildungen.json' : 'ohne abbildungen.json' }}
                              <template v-if="cluster.abbildungen.plan.ohneAngaben">
                                · {{ cluster.abbildungen.plan.ohneAngaben }} ohne Angaben
                              </template>
                            </p>
                            <ul class="max-h-64 space-y-0.5 overflow-y-auto">
                              <li
                                v-for="bild in alleBilderOffen.has(cluster.clusterId)
                                  ? cluster.abbildungen.plan.eintraege
                                  : cluster.abbildungen.plan.eintraege.slice(0, MAX_BILDER_VORSCHAU)"
                                :key="bild.ref"
                                class="truncate"
                                :class="bild.varianteVonRef && 'pl-4'"
                              >
                                <UiIcon :name="bild.varianteVonRef ? 'clone' : 'image'" class="mr-1" />
                                <span class="text-ink">{{ bild.metadaten.titel || bild.dateiName }}</span>
                                <template v-if="bild.metadaten.seite"> · S. {{ bild.metadaten.seite }}</template>
                                <template v-if="bild.metadaten.abbildung"> · Abb. {{ bild.metadaten.abbildung }}</template>
                                <span class="text-ink-subtle"> · {{ bild.dateiName }}</span>
                              </li>
                            </ul>
                            <button
                              v-if="cluster.abbildungen.plan.eintraege.length > MAX_BILDER_VORSCHAU && !alleBilderOffen.has(cluster.clusterId)"
                              type="button"
                              class="text-primary hover:underline"
                              @click="alleBilderOffen.add(cluster.clusterId)"
                            >
                              Alle {{ cluster.abbildungen.plan.eintraege.length }} Bilder zeigen
                            </button>
                          </div>
                          <ul v-else class="mt-1 space-y-0.5">
                            <li
                              v-for="ref in cluster.fileRefs"
                              :key="ref"
                              class="truncate text-xs text-ink-muted"
                            >
                              <UiIcon :name="dateiIcon(dateiNachRef.get(ref)?.fileName)" class="mr-1" />
                              {{ dateiNachRef.get(ref)?.relativePath || dateiNachRef.get(ref)?.fileName }}
                              <template v-if="dateiNachRef.get(ref)?.sizeBytes">
                                · {{ formatBytes(dateiNachRef.get(ref)!.sizeBytes) }}
                              </template>
                              <template v-if="dateiNachRef.get(ref)?.duplicate">
                                · Dublette: {{ dateiNachRef.get(ref)!.duplicate!.title }}
                              </template>
                              <span
                                v-if="dateiNachRef.get(ref)?.stagingMissing && data.clusterOutcomes[cluster.clusterId]?.outcome !== 'erstellt'"
                                class="text-danger"
                              >
                                · Datei fehlt
                              </span>
                            </li>
                          </ul>
                          <ul v-if="cluster.warnings.length" class="mt-1 space-y-0.5">
                            <li
                              v-for="(w, i) in cluster.warnings"
                              :key="i"
                              class="text-xs text-warning"
                            >
                              {{ w }}
                            </li>
                          </ul>
                        </div>

                        <template v-if="cluster.kind === 'abbildungssammlung' && bearbeitbar(cluster.clusterId) && mapping.records[cluster.clusterId]">
                          <div class="grid gap-3 sm:grid-cols-2">
                            <UiField label="Titel der Sammlung" class="sm:col-span-2">
                              <UiInput v-model="mapping.records[cluster.clusterId]!.title" />
                            </UiField>
                            <UiField label="Kurzbeschreibung" class="sm:col-span-2">
                              <UiInput v-model="mapping.records[cluster.clusterId]!.description" />
                            </UiField>
                            <UiField label="Schlagwörter" class="sm:col-span-2">
                              <UiTagInput
                                v-model="mapping.records[cluster.clusterId]!.tagNames"
                                :vorschlaege="schlagwortNamen"
                              />
                            </UiField>
                          </div>
                          <p class="text-xs text-ink-subtle">
                            Gibt es im gewählten Lehrwerk schon eine Sammlung mit diesem Titel, werden die Bilder dort ergänzt
                            (bereits vorhandene Bilder werden übersprungen).
                          </p>
                        </template>
                        <template v-else-if="bearbeitbar(cluster.clusterId) && mapping.records[cluster.clusterId]">
                          <div class="grid gap-3 sm:grid-cols-2">
                            <UiField label="Titel" class="sm:col-span-2">
                              <UiInput v-model="mapping.records[cluster.clusterId]!.title" />
                            </UiField>
                            <UiField label="Materialart">
                              <UiSelect
                                v-model="mapping.records[cluster.clusterId]!.materialType"
                                :optionen="materialTypes.options().map((o) => ({ value: o.value, label: o.label }))"
                              />
                            </UiField>
                            <UiField label="Schlagwörter">
                              <UiTagInput
                                v-model="mapping.records[cluster.clusterId]!.tagNames"
                                :vorschlaege="schlagwortNamen"
                              />
                            </UiField>
                            <UiField
                              v-for="ref in cluster.fileRefs"
                              :key="`role-${ref}`"
                              :label="dateiNachRef.get(ref)?.fileName ?? 'Datei'"
                            >
                              <UiSelect
                                v-model="mapping.records[cluster.clusterId]!.fileRoles[ref]"
                                :optionen="dateiRollen"
                              />
                            </UiField>
                            <UiField v-if="hatLoesung(cluster.clusterId)" label="Titel der Lösung" class="sm:col-span-2">
                              <UiInput
                                v-model="mapping.records[cluster.clusterId]!.solutionTitle"
                                :platzhalter="`Musterlösung: ${mapping.records[cluster.clusterId]!.title}`"
                              />
                            </UiField>
                            <UiField label="Kurzbeschreibung" class="sm:col-span-2">
                              <UiInput v-model="mapping.records[cluster.clusterId]!.description" />
                            </UiField>
                            <UiField label="Lernziele" class="sm:col-span-2">
                              <UiTagInput
                                v-model="mapping.records[cluster.clusterId]!.learningObjectives"
                                platzhalter="Lernziel hinzufügen …"
                              />
                            </UiField>
                            <UiField label="Inhalt / Zusammenfassung" class="sm:col-span-2">
                              <UiInput v-model="mapping.records[cluster.clusterId]!.content" />
                            </UiField>
                          </div>
                          <div v-if="cluster.proposedLinks.length" class="space-y-1">
                            <p class="text-xs font-medium text-ink-muted">Vorgeschlagene Verknüpfungen</p>
                            <label
                              v-for="link in cluster.proposedLinks"
                              :key="link.targetClusterId"
                              class="flex items-start gap-2 text-sm"
                            >
                              <input
                                v-model="mapping.records[cluster.clusterId]!.links[link.targetClusterId]"
                                type="checkbox"
                                class="mt-1 accent-[var(--color-primary)]"
                              >
                              <span>
                                {{ link.reason }}
                                <span class="text-xs text-ink-subtle">
                                  → {{ titelNachCluster.get(link.targetClusterId) || 'anderes Bündel' }}
                                </span>
                              </span>
                            </label>
                          </div>
                        </template>
                        <template v-else>
                          <p class="font-medium text-ink">
                            {{ mapping.records[cluster.clusterId]?.title ?? cluster.suggestions.title }}
                          </p>
                          <p class="text-sm text-ink-muted">
                            {{ materialTypes.label((mapping.records[cluster.clusterId]?.materialType ?? cluster.suggestions.materialType) as never) }}
                          </p>
                        </template>
                      </div>
                    </div>
                  </li>
                </ul>
              </section>
            </div>
          </UiCard>
        </div>

        <aside>
          <UiCard titel="Protokoll" icon="list" einklappbar einklapp-id="stapel-protokoll">
            <ul class="max-h-[28rem] space-y-2 overflow-y-auto text-xs">
              <li
                v-for="eintrag in logs"
                :key="eintrag.id"
                class="rounded-lg px-2 py-1.5"
                :class="{
                  'bg-danger-soft text-danger': eintrag.level === 'fehler',
                  'bg-warning-soft text-warning': eintrag.level === 'warnung',
                  'bg-surface-sunken text-ink-muted': eintrag.level === 'info',
                }"
              >
                {{ eintrag.message }}
              </li>
              <li v-if="!logs.length" class="text-ink-subtle">Noch keine Einträge</li>
            </ul>
          </UiCard>
        </aside>
      </div>
    </template>

    <UiConfirm
      v-model="abbrechenOffen"
      titel="Analyse abbrechen?"
      text="Die Analyse hört nach der Datei auf, an der sie gerade arbeitet. Der Stapel bleibt als fehlgeschlagen stehen und kann danach verworfen werden."
      bestaetigen="Analyse abbrechen"
      abbrechen="Weiterlaufen lassen"
      @bestaetigt="analyseAbbrechen"
    />
    <UiConfirm
      v-model="verwerfenOffen"
      gefahr
      titel="Stapel verwerfen?"
      text="Der Stapel und alle hochgeladenen Dateien werden entfernt. Es werden keine Materialien angelegt. Eine laufende Analyse wird dabei abgebrochen."
      bestaetigen="Ja, verwerfen"
      @bestaetigt="verwerfen"
    />
    <UiConfirm
      v-model="rueckgaengigOffen"
      gefahr
      titel="Stapel rückgängig machen?"
      text="Alle in diesem Stapel angelegten Materialien werden gelöscht. Der Stapel kehrt mit Dateien, KI-Vorschlägen und Entscheidungen zur Vorschau zurück und lässt sich korrigiert erneut anlegen – ohne neuen Upload und ohne neue Analyse."
      bestaetigen="Rückgängig machen"
      @bestaetigt="rueckgaengig"
    />
    <UiConfirm
      v-model="resteVerwerfenOffen"
      gefahr
      titel="Übrige Dateien verwerfen?"
      text="Die Dateien der nicht angelegten Bündel werden gelöscht; diese Bündel lassen sich danach nicht mehr anlegen. Angelegte Materialien bleiben bestehen und lassen sich weiterhin rückgängig machen."
      bestaetigen="Ja, verwerfen"
      @bestaetigt="resteVerwerfen"
    />
  </div>
</template>
