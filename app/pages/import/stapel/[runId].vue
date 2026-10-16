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
  warnings: string[]
}

interface DetectedCluster {
  clusterId: string
  kind: 'paar' | 'varianten' | 'einzeln' | 'unklar'
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
  mapping: {
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
  gueltig: () => geladen.value && Boolean(data.value?.canCommit),
  speichern: async (daten) => {
    await $fetch(`/api/materials/bulk/${runId.value}/mapping`, {
      method: 'PATCH',
      body: { ...daten, gradeLevels: daten.gradeLevels },
    })
  },
})

const analyseLaeuft = computed(() => Boolean(data.value?.analysisPending))

const schritt = computed(() => {
  const s = data.value?.status
  if (!s || analyseLaeuft.value) return 1
  if (['importiert', 'teilweise_importiert', 'fehlgeschlagen', 'rueckgaengig'].includes(s)) return 4
  if (s === 'laeuft') return 3
  return 2
})

function clusterMaterialzahl(clusterId: string): number {
  const record = mapping.records[clusterId]
  if (!record?.include) return 0
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
  await autosave.jetztSpeichern()
  if (autosave.zustand.value === 'fehler') return
  const ergebnis = await aufruf(`/api/materials/bulk/${runId.value}/commit`, {
    method: 'POST',
    erfolgsmeldung: 'Materialien angelegt.',
  })
  if (ergebnis) await refresh()
}

const abbrechenOffen = ref(false)
const verwerfenOffen = ref(false)

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
    erfolgsmeldung: 'Stapel rückgängig gemacht.',
  })
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
  analyseLaeuft,
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
            v-if="data.canUndo"
            variante="sekundaer"
            icon="rotate-left"
            :laedt="laeuft"
            @click="rueckgaengig"
          >
            Rückgängig
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
            <p class="mt-3 text-xs text-ink-subtle">
              Änderungen werden automatisch gespeichert.
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
                      <label v-if="data.canCommit && mapping.records[cluster.clusterId]" class="mt-2">
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
                              cluster.kind === 'paar'
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
                          <ul class="mt-1 space-y-0.5">
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

                        <template v-if="data.canCommit && mapping.records[cluster.clusterId]">
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
  </div>
</template>
