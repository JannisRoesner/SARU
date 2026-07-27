<script setup lang="ts">
import { materialTypes, importStatuses } from '#shared/utils/labels'
import {
  jahrgangsstufenOptionen,
  normalizeGradeLevel,
  type GradeLevel,
} from '#shared/utils/jahrgangsstufen'
import type { MaterialType } from '#shared/types/domain'

const route = useRoute()
const runId = computed(() => String(route.params.runId))
const { darfBearbeiten } = useSitzung()
const { aufruf, laeuft } = useApi()
const { fachOptionen, schlagwortNamen } = useTaxonomie()
const { optionen: schulformOptionen } = useSchulformen()

const jahrgangOptionen = jahrgangsstufenOptionen()

if (!darfBearbeiten.value) await navigateTo('/materialien')

interface DetectedFile {
  sourceRef: string
  fileName: string
  sizeBytes: number
  pageCount: number | null
  hasText: boolean
  textPreview: string | null
  duplicate: { materialId: string; title: string; reason: string } | null
  suggestions: {
    title: string
    materialType: MaterialType
    tagNames: string[]
    description: string
    aiUsed: boolean
  }
  warnings: string[]
}

interface RunOverview {
  runId: string
  adapterLabel: string
  status: string
  sourceFileName: string
  sourceSizeBytes: number | null
  files: DetectedFile[]
  mapping: {
    subjectId?: string | null
    subjectName?: string
    gradeLevel?: GradeLevel | null
    schoolForm?: string | null
    defaultMaterialType?: MaterialType
    linkDuplicates?: boolean
    records?: Record<
      string,
      {
        include: boolean
        title?: string
        materialType?: MaterialType
        description?: string
        tagNames?: string[]
        action?: string
        duplicateOfId?: string | null
      }
    >
  } | null
  stats: Record<string, number> | null
  errorMessage: string | null
  aiEnabled: boolean
  canCommit: boolean
  canUndo: boolean
}

const { data, status, error, refresh } = await useFetch<RunOverview>(
  () => `/api/materials/bulk/${runId.value}`,
)

useHead({ title: () => (data.value ? `Stapel · ${data.value.sourceFileName}` : 'Stapel-Upload') })

const mapping = reactive({
  subjectId: null as string | null,
  subjectName: '',
  gradeLevel: null as GradeLevel | null,
  schoolForm: null as string | null,
  defaultMaterialType: 'arbeitsblatt' as MaterialType,
  linkDuplicates: true,
  records: {} as Record<
    string,
    {
      include: boolean
      title: string
      materialType: MaterialType
      description: string
      tagNames: string[]
      action: string
      duplicateOfId: string | null
    }
  >,
})

const geladen = ref(false)

watch(
  data,
  (wert) => {
    if (!wert?.mapping) return
    const m = wert.mapping
    mapping.subjectId = m.subjectId ?? null
    mapping.subjectName = m.subjectName ?? ''
    mapping.gradeLevel = normalizeGradeLevel(m.gradeLevel) ?? null
    mapping.schoolForm = m.schoolForm ?? null
    mapping.defaultMaterialType = m.defaultMaterialType ?? 'arbeitsblatt'
    mapping.linkDuplicates = m.linkDuplicates ?? true

    const records: typeof mapping.records = {}
    for (const file of wert.files) {
      const existing = m.records?.[file.sourceRef]
      records[file.sourceRef] = {
        include: existing?.include ?? true,
        title: existing?.title ?? file.suggestions.title,
        materialType: existing?.materialType ?? file.suggestions.materialType,
        description: existing?.description ?? file.suggestions.description ?? '',
        tagNames: [...(existing?.tagNames ?? file.suggestions.tagNames ?? [])],
        action: existing?.action ?? 'erstellen',
        duplicateOfId: existing?.duplicateOfId ?? file.duplicate?.materialId ?? null,
      }
    }
    mapping.records = records
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
    const gradeLevel = normalizeGradeLevel(daten.gradeLevel)
    await $fetch(`/api/materials/bulk/${runId.value}/mapping`, {
      method: 'PATCH',
      body: { ...daten, gradeLevel },
    })
  },
})

const schritt = computed(() => {
  const s = data.value?.status
  if (!s) return 1
  if (['importiert', 'teilweise_importiert', 'fehlgeschlagen', 'rueckgaengig'].includes(s)) return 4
  if (s === 'laeuft') return 3
  return 2
})

const ausgewaehlt = computed(
  () => Object.values(mapping.records).filter((r) => r.include).length,
)

async function committen() {
  await autosave.jetztSpeichern()
  if (autosave.zustand.value === 'fehler') return
  const ergebnis = await aufruf(`/api/materials/bulk/${runId.value}/commit`, {
    method: 'POST',
    erfolgsmeldung: 'Materialien angelegt.',
  })
  if (ergebnis) await refresh()
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

function alleWaehlen(wert: boolean) {
  for (const key of Object.keys(mapping.records)) {
    mapping.records[key]!.include = wert
  }
}
</script>

<template>
  <div>
    <div class="mb-2">
      <NuxtLink
        to="/materialien/stapel"
        class="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary"
      >
        <UiIcon name="arrow-left" fest /> Alle Stapel
      </NuxtLink>
    </div>

    <UiFehlerzustand v-if="error" :text="toApiFehler(error).nachricht" @erneut="refresh()" />
    <UiSkelett v-else-if="status === 'pending' || !data" art="list" :zeilen="6" />

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
            {{ ausgewaehlt }} Materialien anlegen
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
              <UiField label="Fach (bestehend)">
                <UiSelect v-model="mapping.subjectId" platzhalter="Neu anlegen …" :optionen="fachOptionen" />
              </UiField>
              <UiField label="Fachname (neu)">
                <UiInput v-model="mapping.subjectName" :disabled="Boolean(mapping.subjectId)" />
              </UiField>
              <UiField label="Jahrgang">
                <UiSelect
                  v-model="mapping.gradeLevel"
                  platzhalter="Keiner"
                  :optionen="jahrgangOptionen.map((o) => ({ value: o.value, label: o.label }))"
                />
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
            </div>
            <p class="mt-3 text-xs text-ink-subtle">
              Änderungen werden automatisch gespeichert.
            </p>
          </UiCard>

          <UiCard titel="Vorschau &amp; Prüfung" icon="eye" einklappbar einklapp-id="stapel-vorschau">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p class="text-sm text-ink-muted">
                {{ data.files.length }} Dateien · {{ ausgewaehlt }} ausgewählt
              </p>
              <div v-if="data.canCommit" class="flex gap-2 text-xs">
                <button type="button" class="text-primary hover:underline" @click="alleWaehlen(true)">
                  Alle
                </button>
                <button type="button" class="text-ink-muted hover:underline" @click="alleWaehlen(false)">
                  Keine
                </button>
              </div>
            </div>

            <ul class="space-y-3">
              <li
                v-for="file in data.files"
                :key="file.sourceRef"
                class="rounded-xl border border-line p-3"
              >
                <div class="flex flex-wrap items-start gap-3">
                  <label v-if="data.canCommit && mapping.records[file.sourceRef]" class="mt-2">
                    <input
                      v-model="mapping.records[file.sourceRef]!.include"
                      type="checkbox"
                      class="accent-[var(--color-primary)]"
                    >
                  </label>
                  <div class="min-w-0 flex-1 space-y-3">
                    <div>
                      <p class="truncate text-xs text-ink-subtle">
                        <UiIcon name="file-pdf" class="mr-1" />
                        {{ file.fileName }}
                        · {{ formatBytes(file.sizeBytes) }}
                        <template v-if="file.pageCount"> · {{ file.pageCount }} S.</template>
                        <template v-if="file.suggestions.aiUsed"> · KI</template>
                      </p>
                      <p v-if="file.duplicate" class="mt-1 text-xs text-warning">
                        Dublette: {{ file.duplicate.title }}
                      </p>
                      <ul v-if="file.warnings.length" class="mt-1 space-y-0.5">
                        <li
                          v-for="(w, i) in file.warnings"
                          :key="i"
                          class="text-xs text-warning"
                        >
                          {{ w }}
                        </li>
                      </ul>
                    </div>

                    <template v-if="data.canCommit && mapping.records[file.sourceRef]">
                      <div class="grid gap-3 sm:grid-cols-2">
                        <UiField label="Titel" class="sm:col-span-2">
                          <UiInput v-model="mapping.records[file.sourceRef]!.title" />
                        </UiField>
                        <UiField label="Materialart">
                          <UiSelect
                            v-model="mapping.records[file.sourceRef]!.materialType"
                            :optionen="materialTypes.options().map((o) => ({ value: o.value, label: o.label }))"
                          />
                        </UiField>
                        <UiField label="Schlagwörter">
                          <UiTagInput
                            v-model="mapping.records[file.sourceRef]!.tagNames"
                            :vorschlaege="schlagwortNamen"
                          />
                        </UiField>
                        <UiField label="Kurzbeschreibung" class="sm:col-span-2">
                          <UiInput v-model="mapping.records[file.sourceRef]!.description" />
                        </UiField>
                      </div>
                    </template>
                    <template v-else>
                      <p class="font-medium text-ink">
                        {{ mapping.records[file.sourceRef]?.title ?? file.suggestions.title }}
                      </p>
                      <p class="text-sm text-ink-muted">
                        {{ materialTypes.label((mapping.records[file.sourceRef]?.materialType ?? file.suggestions.materialType) as never) }}
                      </p>
                    </template>
                  </div>
                </div>
              </li>
            </ul>
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
  </div>
</template>
