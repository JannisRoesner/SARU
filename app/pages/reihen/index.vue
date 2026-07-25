<script setup lang="ts">
import { seriesStatuses } from '#shared/utils/labels'
import type { SeriesSummary } from '~~/server/repositories/series.repository'
import type { Paginated } from '#shared/types/domain'

useHead({ title: 'Unterrichtsreihen' })

const route = useRoute()
const router = useRouter()
const { darfBearbeiten } = useSitzung()

const suche = ref(String(route.query.q ?? ''))
const sort = ref(String(route.query.sort ?? 'datum_neu'))
const page = ref(Number(route.query.page ?? 1) || 1)
const statusFilter = ref<string | null>((route.query.status as string) || null)

const query = computed(() => ({
  q: suche.value.trim() || undefined,
  sort: sort.value,
  page: page.value,
  pageSize: 24,
  statuses: statusFilter.value || undefined,
}))

const { data, status, error, refresh } = await useFetch<
  Paginated<SeriesSummary> & { query: string | null }
>('/api/series', { query, watch: [query] })

function syncQuery() {
  void router.replace({
    query: {
      q: suche.value.trim() || undefined,
      sort: sort.value !== 'datum_neu' ? sort.value : undefined,
      page: page.value > 1 ? String(page.value) : undefined,
      status: statusFilter.value || undefined,
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
watch([sort, statusFilter], () => {
  page.value = 1
  syncQuery()
})
watch(page, syncQuery)
</script>

<template>
  <div>
    <LayoutSeitenkopf
      kicker="Struktur"
      titel="Unterrichtsreihen"
      untertitel="Themenbögen über mehrere Stunden – mit Fortschritt, Materialien und Druckansicht."
    >
      <template v-if="darfBearbeiten" #aktionen>
        <UiButton to="/reihen/neu" variante="primaer" icon="plus">Reihe starten</UiButton>
      </template>
    </LayoutSeitenkopf>

    <div class="mb-5 grid gap-3 sm:grid-cols-[1fr_14rem]">
      <UiField label="Suche">
        <UiInput v-model="suche" icon="magnifying-glass" placeholder="Titel, Beschreibung …" />
      </UiField>
      <UiField label="Sortierung">
        <UiSelect
          v-model="sort"
          :optionen="[
            { value: 'datum_neu', label: 'Zuletzt bearbeitet' },
            { value: 'titel', label: 'Titel' },
            { value: 'fortschritt', label: 'Fortschritt' },
          ]"
        />
      </UiField>
    </div>

    <div class="mb-4 flex flex-wrap gap-2">
      <button
        v-for="opt in seriesStatuses.options()"
        :key="opt.value"
        type="button"
        class="filter-chip"
        :class="statusFilter === opt.value && 'filter-chip-aktiv'"
        @click="statusFilter = statusFilter === opt.value ? null : opt.value"
      >
        {{ opt.label }}
      </button>
    </div>

    <UiFehlerzustand v-if="error" :text="toApiFehler(error).nachricht" @erneut="refresh()" />
    <template v-else>
      <UiSkelett v-if="status === 'pending'" art="cards" :zeilen="4" />
      <UiLeerzustand
        v-else-if="!(data?.items.length)"
        icon="layer-group"
        titel="Keine Reihen"
        text="Bündele zusammengehörige Stunden zu einer Unterrichtsreihe."
      >
        <UiButton v-if="darfBearbeiten" to="/reihen/neu" variante="primaer" icon="plus">
          Reihe starten
        </UiButton>
      </UiLeerzustand>
      <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <ReiheKarte v-for="reihe in data?.items" :key="reihe.id" :reihe="reihe" />
      </div>
    </template>
  </div>
</template>
