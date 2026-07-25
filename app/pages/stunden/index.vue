<script setup lang="ts">
import { lessonStatuses } from '#shared/utils/labels'
import type { LessonSummary } from '~~/server/repositories/lesson.repository'
import type { Paginated } from '#shared/types/domain'

useHead({ title: 'Unterrichtsstunden' })

const route = useRoute()
const router = useRouter()
const { darfBearbeiten } = useSitzung()
const { fachOptionen, lerngruppenOptionen } = useTaxonomie()

const suche = ref(String(route.query.q ?? ''))
const sort = ref(String(route.query.sort ?? 'datum_neu'))
const page = ref(Number(route.query.page ?? 1) || 1)
const statusFilter = ref<string | null>((route.query.status as string) || null)
const fachId = ref<string | null>((route.query.fach as string) || null)
const gruppeId = ref<string | null>((route.query.gruppe as string) || null)

const query = computed(() => ({
  q: suche.value.trim() || undefined,
  sort: sort.value,
  page: page.value,
  pageSize: 24,
  statuses: statusFilter.value || undefined,
  subjectIds: fachId.value || undefined,
  learningGroupIds: gruppeId.value || undefined,
}))

const { data, status, error, refresh } = await useFetch<
  Paginated<LessonSummary> & { query: string | null }
>('/api/lessons', { query, watch: [query] })

const sortOptionen = [
  { value: 'datum_neu', label: 'Datum (neueste)' },
  { value: 'datum_alt', label: 'Datum (älteste)' },
  { value: 'titel', label: 'Titel' },
  { value: 'zuletzt_bearbeitet', label: 'Zuletzt bearbeitet' },
]

function syncQuery() {
  void router.replace({
    query: {
      q: suche.value.trim() || undefined,
      sort: sort.value !== 'datum_neu' ? sort.value : undefined,
      page: page.value > 1 ? String(page.value) : undefined,
      status: statusFilter.value || undefined,
      fach: fachId.value || undefined,
      gruppe: gruppeId.value || undefined,
    },
  })
}

let timer: ReturnType<typeof setTimeout> | undefined
watch(suche, () => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    page.value = 1
    syncQuery()
  }, 250)
})
watch([sort, statusFilter, fachId, gruppeId], () => {
  page.value = 1
  syncQuery()
})
watch(page, syncQuery)
</script>

<template>
  <div>
    <LayoutSeitenkopf
      kicker="Planung"
      titel="Unterrichtsstunden"
      untertitel="Verlaufspläne mit Phasen, Methoden und zugeordneten Materialien."
    >
      <template v-if="darfBearbeiten" #aktionen>
        <UiButton to="/stunden/neu" variante="primaer" icon="calendar-plus">
          Stunde planen
        </UiButton>
      </template>
    </LayoutSeitenkopf>

    <div class="mb-5 grid gap-3 lg:grid-cols-[1fr_12rem_12rem]">
      <UiField label="Suche">
        <UiInput v-model="suche" icon="magnifying-glass" placeholder="Thema, Notiz …" />
      </UiField>
      <UiField label="Status">
        <UiSelect
          v-model="statusFilter"
          platzhalter="Alle"
          :optionen="lessonStatuses.options().map((o) => ({ value: o.value, label: o.label }))"
        />
      </UiField>
      <UiField label="Sortierung">
        <UiSelect v-model="sort" :optionen="sortOptionen" />
      </UiField>
    </div>

    <div class="mb-4 flex flex-wrap gap-2">
      <button
        v-for="opt in lessonStatuses.options()"
        :key="opt.value"
        type="button"
        class="filter-chip"
        :class="statusFilter === opt.value && 'filter-chip-aktiv'"
        @click="statusFilter = statusFilter === opt.value ? null : opt.value"
      >
        <UiIcon v-if="opt.icon" :name="opt.icon" fest />
        {{ opt.label }}
      </button>
    </div>

    <UiFehlerzustand v-if="error" :text="toApiFehler(error).nachricht" @erneut="refresh()" />
    <template v-else>
      <p class="mb-3 text-sm text-ink-muted">
        <span class="font-medium text-ink">{{ formatZahl(data?.total ?? 0) }}</span>
        Stunden
      </p>
      <UiSkelett v-if="status === 'pending'" art="list" :zeilen="5" />
      <UiLeerzustand
        v-else-if="!(data?.items.length)"
        icon="chalkboard-user"
        titel="Keine Stunden"
        text="Plane deine erste Unterrichtsstunde oder importiere einen Kurs aus dem SchulPortal."
      >
        <UiButton v-if="darfBearbeiten" to="/stunden/neu" variante="primaer" icon="plus">
          Stunde planen
        </UiButton>
      </UiLeerzustand>
      <div v-else class="space-y-2">
        <StundeKarte v-for="stunde in data?.items" :key="stunde.id" :stunde="stunde" />
      </div>
      <div v-if="(data?.pageCount ?? 0) > 1" class="mt-6 flex items-center justify-center gap-2">
        <UiButton
          variante="sekundaer"
          icon="chevron-left"
          nur-icon
          title="Zurück"
          :disabled="page <= 1"
          @click="page--"
        />
        <span class="text-sm text-ink-muted">Seite {{ page }} / {{ data?.pageCount }}</span>
        <UiButton
          variante="sekundaer"
          icon="chevron-right"
          nur-icon
          title="Weiter"
          :disabled="page >= (data?.pageCount ?? 1)"
          @click="page++"
        />
      </div>
    </template>
  </div>
</template>
