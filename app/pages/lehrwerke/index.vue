<script setup lang="ts">
import type { MaterialSummary, MaterialFacets } from '~~/server/repositories/material.repository'
import type { Paginated } from '#shared/types/domain'

useHead({ title: 'Lehrwerke' })

const route = useRoute()
const router = useRouter()
const { darfBearbeiten } = useSitzung()

const suche = ref(String(route.query.q ?? ''))
const sort = ref(String(route.query.sort ?? 'titel'))
const page = ref(Number(route.query.page ?? 1) || 1)
const nurFavoriten = ref(route.query.favoriten === '1')
const archiviert = ref(route.query.archiv === '1')
const fachId = ref<string | null>((route.query.fach as string) || null)

const query = computed(() => ({
  q: suche.value.trim() || undefined,
  sort: suche.value.trim() && sort.value === 'titel' ? 'relevanz' : sort.value,
  page: page.value,
  pageSize: 24,
  onlyFavorites: nurFavoriten.value || undefined,
  includeArchived: archiviert.value || undefined,
  subjectIds: fachId.value || undefined,
  materialTypes: 'lehrwerk',
}))

const { data, status, error, refresh } = await useFetch<
  Paginated<MaterialSummary> & { query: string | null }
>('/api/materials', { query, watch: [query] })

const { data: facetten } = await useFetch<MaterialFacets>('/api/materials/facets', {
  query: computed(() => ({
    materialTypes: 'lehrwerk',
    onlyFavorites: nurFavoriten.value || undefined,
    includeArchived: archiviert.value || undefined,
  })),
})

const { favoritSetzen } = useMaterialAktionen(() => refresh())

const sortOptionen = [
  { value: 'titel', label: 'Titel' },
  { value: 'datum_neu', label: 'Zuletzt bearbeitet' },
  { value: 'relevanz', label: 'Relevanz' },
]

let sucheTimer: ReturnType<typeof setTimeout> | undefined
watch(suche, () => {
  if (sucheTimer) clearTimeout(sucheTimer)
  sucheTimer = setTimeout(() => {
    page.value = 1
    syncQuery()
  }, 250)
})

watch([sort, nurFavoriten, archiviert, fachId], () => {
  page.value = 1
  syncQuery()
})

watch(page, syncQuery)

function syncQuery() {
  void router.replace({
    query: {
      q: suche.value.trim() || undefined,
      sort: sort.value !== 'titel' ? sort.value : undefined,
      page: page.value > 1 ? String(page.value) : undefined,
      favoriten: nurFavoriten.value ? '1' : undefined,
      archiv: archiviert.value ? '1' : undefined,
      fach: fachId.value || undefined,
    },
  })
}

const fachChips = computed(() => (facetten.value?.subjects ?? []).slice(0, 8))
</script>

<template>
  <div>
    <LayoutSeitenkopf
      kicker="Sammlung"
      titel="Lehrwerke"
      untertitel="Schulbücher als Einstieg: zum Buch gehören Lösungsheft, Serviceband, Kopiervorlagen und alles andere Zugeordnete."
    >
      <template v-if="darfBearbeiten" #aktionen>
        <UiButton to="/materialien/stapel" variante="sekundaer" icon="layer-group">
          Stapel-Upload
        </UiButton>
        <UiButton to="/lehrwerke/neu" variante="primaer" icon="plus">
          Lehrwerk anlegen
        </UiButton>
      </template>
    </LayoutSeitenkopf>

    <div class="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end">
      <div class="flex-1">
        <UiField>
          <UiInput
            v-model="suche"
            icon="magnifying-glass"
            placeholder="Liste eingrenzen …"
            aria-label="Lehrwerke eingrenzen"
          />
        </UiField>
      </div>
      <div class="w-full sm:w-56">
        <UiField label="Sortierung">
          <UiSelect v-model="sort" :optionen="sortOptionen" />
        </UiField>
      </div>
    </div>

    <div class="mb-4 flex flex-wrap gap-2">
      <button
        type="button"
        class="filter-chip"
        :class="nurFavoriten && 'filter-chip-aktiv'"
        @click="nurFavoriten = !nurFavoriten"
      >
        <UiIcon name="star" fest /> Favoriten
      </button>
      <button
        type="button"
        class="filter-chip"
        :class="archiviert && 'filter-chip-aktiv'"
        @click="archiviert = !archiviert"
      >
        <UiIcon name="box-archive" fest /> Archiv
      </button>
      <button
        v-for="fach in fachChips"
        :key="fach.id"
        type="button"
        class="filter-chip"
        :class="fachId === fach.id && 'filter-chip-aktiv'"
        @click="fachId = fachId === fach.id ? null : fach.id"
      >
        {{ fach.name }}
        <span class="text-ink-subtle">{{ fach.count }}</span>
      </button>
    </div>

    <UiFehlerzustand v-if="error" :text="toApiFehler(error).nachricht" @erneut="refresh()" />

    <template v-else>
      <p class="mb-3 text-sm text-ink-muted">
        <span class="font-medium text-ink">{{ formatZahl(data?.total ?? 0) }}</span>
        {{ (data?.total ?? 0) === 1 ? 'Lehrwerk' : 'Lehrwerke' }}
      </p>

      <UiSkelett v-if="status === 'pending'" art="liste" :zeilen="5" />
      <UiLeerzustand
        v-else-if="!(data?.items.length)"
        icon="book"
        titel="Noch keine Lehrwerke"
        text="Lege ein Lehrwerk an oder ordne beim Stapel-Upload alles einem Buch zu."
      >
        <UiButton v-if="darfBearbeiten" to="/lehrwerke/neu" variante="primaer" icon="plus">
          Lehrwerk anlegen
        </UiButton>
      </UiLeerzustand>

      <div v-else class="space-y-2">
        <MaterialKarte
          v-for="material in data?.items"
          :key="material.id"
          :material="material"
          @favorit="favoritSetzen"
        />
      </div>

      <div
        v-if="(data?.pageCount ?? 0) > 1"
        class="mt-6 flex items-center justify-center gap-2"
      >
        <UiButton
          variante="sekundaer"
          icon="chevron-left"
          nur-icon
          title="Vorherige Seite"
          :disabled="page <= 1"
          @click="page--"
        />
        <span class="text-sm text-ink-muted">
          Seite {{ page }} von {{ data?.pageCount }}
        </span>
        <UiButton
          variante="sekundaer"
          icon="chevron-right"
          nur-icon
          title="Nächste Seite"
          :disabled="page >= (data?.pageCount ?? 1)"
          @click="page++"
        />
      </div>
    </template>
  </div>
</template>
