<script setup lang="ts">
import { materialTypes, origins } from '#shared/utils/labels'
import type { MaterialSummary, MaterialFacets } from '~~/server/repositories/material.repository'
import type { Paginated } from '#shared/types/domain'

useHead({ title: 'Materialien' })

const route = useRoute()
const router = useRouter()
const { darfBearbeiten } = useSitzung()
const { fachOptionen } = useTaxonomie()

const suche = ref(String(route.query.q ?? ''))
const sort = ref(String(route.query.sort ?? 'datum_neu'))
const page = ref(Number(route.query.page ?? 1) || 1)
const nurFavoriten = ref(route.query.favoriten === '1' || route.query.onlyFavorites === '1')
const archiviert = ref(route.query.archiv === '1')
const typ = ref<string | null>((route.query.typ as string) || null)
const fachId = ref<string | null>((route.query.fach as string) || null)
const hatDateien = ref(route.query.hatDateien === '1')

const query = computed(() => ({
  q: suche.value.trim() || undefined,
  sort: suche.value.trim() && sort.value === 'datum_neu' ? 'relevanz' : sort.value,
  page: page.value,
  pageSize: 24,
  onlyFavorites: nurFavoriten.value || undefined,
  includeArchived: archiviert.value || undefined,
  materialTypes: typ.value || undefined,
  subjectIds: fachId.value || undefined,
}))

const { data, status, error, refresh } = await useFetch<
  Paginated<MaterialSummary> & { query: string | null }
>('/api/materials', { query, watch: [query] })

const { data: facetten } = await useFetch<MaterialFacets>('/api/materials/facets', {
  query: computed(() => ({
    onlyFavorites: nurFavoriten.value || undefined,
    includeArchived: archiviert.value || undefined,
  })),
})

const eintraege = computed(() => {
  const items = data.value?.items ?? []
  return hatDateien.value ? items.filter((m) => m.assetCount > 0) : items
})

const { favoritSetzen } = useMaterialAktionen(() => refresh())

const sortOptionen = [
  { value: 'datum_neu', label: 'Zuletzt bearbeitet' },
  { value: 'relevanz', label: 'Relevanz' },
  { value: 'titel', label: 'Titel' },
  { value: 'bewertung', label: 'Bewertung' },
  { value: 'zuletzt_verwendet', label: 'Zuletzt verwendet' },
]

let sucheTimer: ReturnType<typeof setTimeout> | undefined
watch(suche, () => {
  if (sucheTimer) clearTimeout(sucheTimer)
  sucheTimer = setTimeout(() => {
    page.value = 1
    syncQuery()
  }, 250)
})

watch([sort, nurFavoriten, archiviert, typ, fachId, hatDateien], () => {
  page.value = 1
  syncQuery()
})

watch(page, syncQuery)

function syncQuery() {
  void router.replace({
    query: {
      q: suche.value.trim() || undefined,
      sort: sort.value !== 'datum_neu' ? sort.value : undefined,
      page: page.value > 1 ? String(page.value) : undefined,
      favoriten: nurFavoriten.value ? '1' : undefined,
      archiv: archiviert.value ? '1' : undefined,
      typ: typ.value || undefined,
      fach: fachId.value || undefined,
      hatDateien: hatDateien.value ? '1' : undefined,
    },
  })
}

const aktiveFilter = computed(() => {
  const chips: { key: string; label: string; clear: () => void }[] = []
  if (nurFavoriten.value) {
    chips.push({ key: 'fav', label: 'Nur Favoriten', clear: () => (nurFavoriten.value = false) })
  }
  if (archiviert.value) {
    chips.push({ key: 'arch', label: 'Archiviert anzeigen', clear: () => (archiviert.value = false) })
  }
  if (hatDateien.value) {
    chips.push({ key: 'datei', label: 'Mit Anhängen', clear: () => (hatDateien.value = false) })
  }
  if (typ.value) {
    chips.push({
      key: 'typ',
      label: materialTypes.label(typ.value as never),
      clear: () => (typ.value = null),
    })
  }
  if (fachId.value) {
    const fach = fachOptionen.value.find((f) => f.value === fachId.value)
    chips.push({
      key: 'fach',
      label: fach?.label ?? 'Fach',
      clear: () => (fachId.value = null),
    })
  }
  return chips
})
</script>

<template>
  <div>
    <LayoutSeitenkopf
      kicker="Sammlung"
      titel="Materialien"
      untertitel="Arbeitsblätter, Präsentationen und anderes Unterrichtsmaterial. Suchen, filtern und wiederverwenden."
    >
      <template v-if="darfBearbeiten" #aktionen>
        <UiButton to="/materialien/neu" variante="primaer" icon="plus">
          Material anlegen
        </UiButton>
      </template>
    </LayoutSeitenkopf>

    <div class="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end">
      <div class="flex-1">
        <UiField label="Suche">
          <UiInput
            v-model="suche"
            icon="magnifying-glass"
            placeholder="Titel, Inhalt, Schlagwort …"
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
        type="button"
        class="filter-chip"
        :class="hatDateien && 'filter-chip-aktiv'"
        @click="hatDateien = !hatDateien"
      >
        <UiIcon name="paperclip" fest /> Mit Anhang
      </button>
      <button
        v-for="eintrag in (facetten?.materialTypes ?? []).slice(0, 6)"
        :key="eintrag.value"
        type="button"
        class="filter-chip"
        :class="typ === eintrag.value && 'filter-chip-aktiv'"
        @click="typ = typ === eintrag.value ? null : eintrag.value"
      >
        {{ materialTypes.label(eintrag.value as never) }}
        <span class="text-ink-subtle">{{ eintrag.count }}</span>
      </button>
    </div>

    <div v-if="aktiveFilter.length" class="mb-4 flex flex-wrap items-center gap-2">
      <span class="text-xs text-ink-subtle">Aktiv:</span>
      <button
        v-for="chip in aktiveFilter"
        :key="chip.key"
        type="button"
        class="filter-chip filter-chip-aktiv"
        @click="chip.clear()"
      >
        {{ chip.label }}
        <UiIcon name="xmark" fest />
      </button>
    </div>

    <UiFehlerzustand v-if="error" :text="toApiFehler(error).nachricht" @erneut="refresh()" />

    <template v-else>
      <div class="mb-3 flex items-baseline justify-between gap-3 text-sm text-ink-muted">
        <p>
          <span class="font-medium text-ink">{{ formatZahl(data?.total ?? 0) }}</span>
          {{ (data?.total ?? 0) === 1 ? 'Material' : 'Materialien' }}
        </p>
      </div>

      <UiSkelett v-if="status === 'pending'" art="list" :zeilen="6" />
      <UiLeerzustand
        v-else-if="!eintraege.length"
        icon="folder-open"
        titel="Keine Materialien gefunden"
        text="Lege ein neues Material an oder importiere einen Export aus dem SchulPortal."
      >
        <UiButton v-if="darfBearbeiten" to="/materialien/neu" variante="primaer" icon="plus">
          Material anlegen
        </UiButton>
      </UiLeerzustand>

      <div v-else class="space-y-2">
        <MaterialKarte
          v-for="material in eintraege"
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
