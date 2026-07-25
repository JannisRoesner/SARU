<script setup lang="ts">
import {
  jahrgangsstufenOptionen,
  normalizeGradeLevel,
  type GradeLevel,
} from '#shared/utils/jahrgangsstufen'

import { importStatuses, lessonStatuses } from '#shared/utils/labels'

const route = useRoute()
const runId = computed(() => String(route.params.runId))
const { darfBearbeiten } = useSitzung()
const { aufruf, laeuft } = useApi()
const { fachOptionen, lerngruppenOptionen } = useTaxonomie()
const { optionenMitAktuell } = useSchulformen()

const jahrgangOptionen = jahrgangsstufenOptionen()

if (!darfBearbeiten.value) await navigateTo('/')

interface AnalyzedLesson {
  sourceRef: string
  date: string | null
  topic: string
  content: string | null
  homework: string | null
  attachments: { fileName: string; sizeBytes: number; duplicate: unknown }[]
  duplicate: { lessonId: string; title: string; confidence: string } | null
  warnings: string[]
}

interface RunOverview {
  runId: string
  adapterLabel: string
  status: string
  sourceFileName: string
  sourceSizeBytes: number
  course: {
    subjectName?: string | null
    groupName?: string | null
    gradeLevel?: number | null
    schoolYear?: string | null
  } | null
  lessons: AnalyzedLesson[]
  orphanFiles: { fileName: string; sizeBytes: number }[]
  mapping: {
    subjectId?: string | null
    subjectName?: string
    learningGroupId?: string | null
    learningGroupName?: string
    gradeLevel?: GradeLevel | null
    schoolYear?: string
    schoolForm?: string | null
    seriesMode?: string
    seriesId?: string | null
    seriesTitle?: string
    defaultLessonStatus?: string
    createMaterials?: boolean
    linkDuplicates?: boolean
    records?: Record<
      string,
      { include: boolean; title?: string; action: string; duplicateOfId?: string | null }
    >
  } | null
  stats: Record<string, number> | null
  errorMessage: string | null
  canCommit: boolean
  canUndo: boolean
}

const { data, status, error, refresh } = await useFetch<RunOverview>(
  () => `/api/imports/${runId.value}`,
)

useHead({ title: () => (data.value ? `Import · ${data.value.sourceFileName}` : 'Import') })

const mapping = reactive({
  subjectId: null as string | null,
  subjectName: '',
  learningGroupId: null as string | null,
  learningGroupName: '',
  gradeLevel: null as GradeLevel | null,
  schoolYear: '',
  schoolForm: null as string | null,
  seriesMode: 'neu',
  seriesTitle: '',
  defaultLessonStatus: 'durchgefuehrt',
  createMaterials: true,
  linkDuplicates: true,
  records: {} as Record<
    string,
    { include: boolean; title?: string; action: string; duplicateOfId?: string | null }
  >,
})

const schulformOptionen = computed(() =>
  optionenMitAktuell(mapping.schoolForm).map((o) => ({ value: o.value, label: o.label })),
)

const geladen = ref(false)

watch(
  data,
  (wert) => {
    if (!wert?.mapping) return
    const m = wert.mapping
    mapping.subjectId = m.subjectId ?? null
    mapping.subjectName = m.subjectName ?? wert.course?.subjectName ?? ''
    mapping.learningGroupId = m.learningGroupId ?? null
    mapping.learningGroupName = m.learningGroupName ?? wert.course?.groupName ?? ''
    mapping.gradeLevel = normalizeGradeLevel(m.gradeLevel ?? wert.course?.gradeLevel) ?? null
    mapping.schoolYear = m.schoolYear ?? wert.course?.schoolYear ?? ''
    mapping.schoolForm = m.schoolForm ?? null
    mapping.seriesMode = m.seriesMode ?? 'neu'
    mapping.seriesTitle = m.seriesTitle ?? ''
    mapping.defaultLessonStatus = m.defaultLessonStatus ?? 'durchgefuehrt'
    mapping.createMaterials = m.createMaterials ?? true
    mapping.linkDuplicates = m.linkDuplicates ?? true
    mapping.records = structuredClone(m.records ?? {})
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
    await $fetch(`/api/imports/${runId.value}/mapping`, {
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

async function committen() {
  // Offene Änderungen sofort schreiben, bevor der Import die Zuordnung liest.
  await autosave.jetztSpeichern()
  if (autosave.zustand.value === 'fehler') return
  const ergebnis = await aufruf(`/api/imports/${runId.value}/commit`, {
    method: 'POST',
    erfolgsmeldung: 'Import abgeschlossen.',
  })
  if (ergebnis) await refresh()
}

async function rueckgaengig() {
  const ok = await aufruf(`/api/imports/${runId.value}/undo`, {
    method: 'POST',
    erfolgsmeldung: 'Import rückgängig gemacht.',
  })
  if (ok) await refresh()
}

const { data: protokoll, refresh: logsLaden } = await useFetch<{
  logs: { id: string; level: string; message: string; createdAt: string }[]
  items: unknown[]
}>(() => `/api/imports/${runId.value}/logs`, {
  default: () => ({ logs: [], items: [] }),
})

const logs = computed(() => protokoll.value?.logs ?? [])

watch(
  () => data.value?.status,
  () => void logsLaden(),
)
</script>

<template>
  <div>
    <div class="mb-2">
      <NuxtLink to="/import" class="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary">
        <UiIcon name="arrow-left" fest /> Alle Importe
      </NuxtLink>
    </div>

    <UiFehlerzustand v-if="error" :text="toApiFehler(error).nachricht" @erneut="refresh()" />
    <UiSkelett v-else-if="status === 'pending' || !data" art="list" :zeilen="6" />

    <template v-else>
      <header class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="seitenkopf-kicker">Import-Assistent</p>
          <h1 class="text-3xl tracking-tight text-ink">{{ data.sourceFileName }}</h1>
          <div class="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <UiBadge
              :ton="importStatuses.tone(data.status as never)"
              :icon="importStatuses.icon(data.status as never)"
            >
              {{ importStatuses.label(data.status as never) }}
            </UiBadge>
            <span>{{ data.adapterLabel }}</span>
            <span>{{ formatBytes(data.sourceSizeBytes) }}</span>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <UiButton
            v-if="data.canCommit"
            variante="primaer"
            icon="check"
            :laedt="laeuft"
            @click="committen"
          >
            Import starten
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
        </div>
      </header>

      <ol class="mb-8 grid gap-2 sm:grid-cols-4">
        <li
          v-for="(label, i) in ['Upload', 'Zuordnung', 'Import', 'Ergebnis']"
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
          <p class="text-xs text-ink-subtle uppercase">{{ key }}</p>
          <p class="text-lg font-semibold tabular-nums">{{ wert }}</p>
        </div>
      </div>

      <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div class="space-y-5">
          <UiCard v-if="data.canCommit" titel="Zuordnung" icon="sliders" einklappbar einklapp-id="import-zuordnung">
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
              <UiField label="Lerngruppe">
                <UiSelect
                  v-model="mapping.learningGroupId"
                  platzhalter="Neu anlegen …"
                  :optionen="lerngruppenOptionen"
                />
              </UiField>
              <UiField label="Gruppenname">
                <UiInput
                  v-model="mapping.learningGroupName"
                  :disabled="Boolean(mapping.learningGroupId)"
                />
              </UiField>
              <UiField label="Jahrgang">
                <UiSelect
                  v-model="mapping.gradeLevel"
                  platzhalter="Keiner"
                  :optionen="jahrgangOptionen.map((o) => ({ value: o.value, label: o.label }))"
                />
              </UiField>
              <UiField label="Schuljahr">
                <UiInput v-model="mapping.schoolYear" />
              </UiField>
              <UiField label="Schulform">
                <UiSelect
                  v-model="mapping.schoolForm"
                  platzhalter="–"
                  :optionen="schulformOptionen"
                />
              </UiField>
              <UiField label="Stundenstatus">
                <UiSelect
                  v-model="mapping.defaultLessonStatus"
                  :optionen="lessonStatuses.options().map((o) => ({ value: o.value, label: o.label }))"
                />
              </UiField>
              <UiField label="Reihentitel" class="sm:col-span-2">
                <UiInput v-model="mapping.seriesTitle" />
              </UiField>
            </div>
            <div class="mt-4 flex flex-wrap gap-4">
              <label class="flex items-center gap-2 text-sm">
                <input v-model="mapping.createMaterials" type="checkbox" class="accent-[var(--color-primary)]">
                Materialien aus Anhängen anlegen
              </label>
              <label class="flex items-center gap-2 text-sm">
                <input v-model="mapping.linkDuplicates" type="checkbox" class="accent-[var(--color-primary)]">
                Dubletten verknüpfen
              </label>
            </div>
            <p class="mt-3 text-xs text-ink-subtle">
              Änderungen an der Zuordnung werden automatisch gespeichert.
            </p>
          </UiCard>

          <UiCard titel="Vorschau der Stunden" icon="eye" einklappbar einklapp-id="import-vorschau">
            <p class="mb-3 text-sm text-ink-muted">
              {{ data.lessons.length }} Stunden erkannt
              <template v-if="data.orphanFiles.length">
                · {{ data.orphanFiles.length }} verwaiste Dateien
              </template>
            </p>
            <ul class="space-y-2">
              <li
                v-for="lesson in data.lessons"
                :key="lesson.sourceRef"
                class="rounded-xl border border-line p-3"
              >
                <div class="flex flex-wrap items-start gap-2">
                  <label v-if="data.canCommit && mapping.records[lesson.sourceRef]" class="mt-1">
                    <input
                      v-model="mapping.records[lesson.sourceRef]!.include"
                      type="checkbox"
                      class="accent-[var(--color-primary)]"
                    >
                  </label>
                  <div class="min-w-0 flex-1">
                    <p class="font-medium text-ink">{{ lesson.topic }}</p>
                    <p class="text-xs text-ink-subtle">
                      {{ lesson.date ? formatDatum(lesson.date) : 'Ohne Datum' }}
                      · {{ lesson.attachments.length }} Anhänge
                    </p>
                    <p v-if="lesson.duplicate" class="mt-1 text-xs text-warning">
                      Mögliche Dublette: {{ lesson.duplicate.title }}
                      ({{ lesson.duplicate.confidence }})
                    </p>
                  </div>
                </div>
              </li>
            </ul>
          </UiCard>
        </div>

        <aside>
          <UiCard titel="Protokoll" icon="list" einklappbar einklapp-id="import-protokoll">
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
