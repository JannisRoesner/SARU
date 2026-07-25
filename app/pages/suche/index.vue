<script setup lang="ts">
import { searchEntityTypes } from '#shared/utils/labels'
import type { MaterialSummary } from '~~/server/repositories/material.repository'
import type { LessonSummary } from '~~/server/repositories/lesson.repository'
import type { SeriesSummary } from '~~/server/repositories/series.repository'

useHead({ title: 'Suche' })

interface Treffer {
  entityType: 'material' | 'unterrichtsstunde' | 'reihe'
  entityId: string
  title: string
  snippet: string | null
  sourceLabel: string | null
  matchedIn: string[]
  score?: number
  datensatz: MaterialSummary | LessonSummary | SeriesSummary
}

interface SuchErgebnis {
  query: string
  treffer: Treffer[]
  anzahl: number
  vektorsucheAktiv: boolean
  proTyp: { material: number; unterrichtsstunde: number; reihe: number }
}

interface GespeicherteSuche {
  id: string
  name: string
  query: string
  sort: string
  filters: Record<string, unknown>
}

const route = useRoute()
const router = useRouter()
const { aufruf, laeuft } = useApi()

const suche = ref(String(route.query.q ?? ''))
const typen = ref<string[]>(
  typeof route.query.typ === 'string'
    ? route.query.typ.split(',').filter(Boolean)
    : [],
)
const speichernOffen = ref(false)
const speicherName = ref('')

const query = computed(() => ({
  q: suche.value.trim(),
  entityTypes: typen.value.length ? typen.value.join(',') : undefined,
  limit: 40,
}))

const { data, status, error, refresh } = await useFetch<SuchErgebnis>('/api/search', {
  query,
  watch: [query],
  immediate: Boolean(suche.value.trim()),
})

const { data: gespeichert, refresh: gespeichertLaden } = await useFetch<GespeicherteSuche[]>(
  '/api/search/saved',
  { default: () => [] },
)

function syncQuery() {
  void router.replace({
    query: {
      q: suche.value.trim() || undefined,
      typ: typen.value.length ? typen.value.join(',') : undefined,
    },
  })
}

let timer: ReturnType<typeof setTimeout> | undefined
watch(suche, () => {
  clearTimeout(timer)
  timer = setTimeout(syncQuery, 250)
})
watch(typen, syncQuery, { deep: true })

function typUmschalten(typ: string) {
  if (typen.value.includes(typ)) {
    typen.value = typen.value.filter((t) => t !== typ)
  } else {
    typen.value = [...typen.value, typ]
  }
}

const chips = computed(() => {
  const liste: { key: string; label: string; clear: () => void }[] = []
  for (const typ of typen.value) {
    liste.push({
      key: typ,
      label: searchEntityTypes.label(typ as never),
      clear: () => typUmschalten(typ),
    })
  }
  return liste
})

async function sucheSpeichern() {
  const ok = await aufruf('/api/search/saved', {
    method: 'POST',
    body: {
      name: speicherName.value,
      query: suche.value.trim(),
      filters: { entityTypes: typen.value.length ? typen.value : undefined },
    },
    erfolgsmeldung: 'Suche gespeichert.',
  })
  if (ok) {
    speichernOffen.value = false
    speicherName.value = ''
    await gespeichertLaden()
  }
}

async function gespeicherteLaden(eintrag: GespeicherteSuche) {
  suche.value = eintrag.query
  const entityTypes = (eintrag.filters?.entityTypes as string[] | undefined) ?? []
  typen.value = entityTypes
  await aufruf(`/api/search/saved/${eintrag.id}`, { method: 'POST', stumm: true }).catch(() => null)
  syncQuery()
}

async function gespeicherteLoeschen(id: string) {
  const ok = await aufruf(`/api/search/saved/${id}`, {
    method: 'DELETE',
    erfolgsmeldung: 'Gespeicherte Suche entfernt.',
  })
  if (ok !== null) await gespeichertLaden()
}

const { favoritSetzen } = useMaterialAktionen(() => refresh())
</script>

<template>
  <div>
    <LayoutSeitenkopf
      kicker="Finden"
      titel="Suche"
      untertitel="Durchsuche Materialien, Stunden und Reihen – inkl. Text aus Anhängen."
    >
      <template #aktionen>
        <UiButton
          variante="sekundaer"
          icon="bookmark"
          :disabled="!suche.trim()"
          @click="speichernOffen = true"
        >
          Speichern
        </UiButton>
      </template>
    </LayoutSeitenkopf>

    <div class="mb-5">
      <UiField label="Suchbegriff">
        <UiInput
          v-model="suche"
          icon="magnifying-glass"
          placeholder="z. B. Photosynthese, Einstieg, Klausur …"
        />
      </UiField>
    </div>

    <div class="mb-4 flex flex-wrap gap-2">
      <button
        v-for="opt in searchEntityTypes.options()"
        :key="opt.value"
        type="button"
        class="filter-chip"
        :class="typen.includes(opt.value) && 'filter-chip-aktiv'"
        @click="typUmschalten(opt.value)"
      >
        <UiIcon v-if="opt.icon" :name="opt.icon" fest />
        {{ opt.label }}
      </button>
    </div>

    <div v-if="chips.length" class="mb-4 flex flex-wrap items-center gap-2">
      <span class="text-xs text-ink-subtle">Filter:</span>
      <button
        v-for="chip in chips"
        :key="chip.key"
        type="button"
        class="filter-chip filter-chip-aktiv"
        @click="chip.clear()"
      >
        {{ chip.label }}
        <UiIcon name="xmark" fest />
      </button>
    </div>

    <div v-if="gespeichert?.length" class="mb-6">
      <p class="mb-2 text-xs font-semibold tracking-wider text-ink-subtle uppercase">
        Gespeicherte Suchen
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="eintrag in gespeichert"
          :key="eintrag.id"
          type="button"
          class="filter-chip group"
          @click="gespeicherteLaden(eintrag)"
        >
          <UiIcon name="bookmark" fest />
          {{ eintrag.name }}
          <span
            class="ml-1 rounded p-0.5 opacity-0 hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
            title="Löschen"
            @click.stop="gespeicherteLoeschen(eintrag.id)"
          >
            <UiIcon name="xmark" fest />
          </span>
        </button>
      </div>
    </div>

    <UiFehlerzustand v-if="error" :text="toApiFehler(error).nachricht" @erneut="refresh()" />

    <template v-else-if="!suche.trim()">
      <UiLeerzustand
        icon="magnifying-glass"
        titel="Wonach suchst du?"
        text="Tippe einen Begriff oder öffne eine gespeicherte Suche. Mit Strg+K erreichst du die Schnellsuche überall."
      />
    </template>

    <template v-else>
      <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-sm text-ink-muted">
        <p>
          <span class="font-medium text-ink">{{ formatZahl(data?.anzahl ?? 0) }}</span>
          Treffer
          <template v-if="data?.vektorsucheAktiv"> · inkl. Ähnlichkeitssuche</template>
        </p>
        <p v-if="data?.proTyp" class="text-xs">
          {{ data.proTyp.material }} Mat. ·
          {{ data.proTyp.unterrichtsstunde }} Std. ·
          {{ data.proTyp.reihe }} Reihen
        </p>
      </div>

      <UiSkelett v-if="status === 'pending'" art="list" :zeilen="5" />
      <UiLeerzustand
        v-else-if="!(data?.treffer.length)"
        icon="magnifying-glass"
        titel="Keine Treffer"
        text="Probiere andere Begriffe oder entferne Filter."
      />

      <div v-else class="space-y-2">
        <template v-for="treffer in data?.treffer" :key="`${treffer.entityType}-${treffer.entityId}`">
          <MaterialKarte
            v-if="treffer.entityType === 'material'"
            :material="treffer.datensatz as MaterialSummary"
            kompakt
            @favorit="favoritSetzen"
          />
          <StundeKarte
            v-else-if="treffer.entityType === 'unterrichtsstunde'"
            :stunde="treffer.datensatz as LessonSummary"
            kompakt
          />
          <ReiheKarte
            v-else
            :reihe="treffer.datensatz as SeriesSummary"
          />
          <p
            v-if="treffer.snippet"
            class="treffer -mt-1 mb-3 rounded-lg bg-surface-sunken/60 px-3 py-2 text-xs leading-relaxed text-ink-muted"
            v-html="treffer.snippet"
          />
        </template>
      </div>
    </template>

    <UiModal v-model="speichernOffen" titel="Suche speichern" icon="bookmark">
      <UiField label="Name" pflicht>
        <UiInput v-model="speicherName" placeholder="z. B. Favoriten Biologie 9" data-autofokus />
      </UiField>
      <template #aktionen>
        <UiButton variante="sekundaer" @click="speichernOffen = false">Abbrechen</UiButton>
        <UiButton
          variante="primaer"
          :laedt="laeuft"
          :disabled="!speicherName.trim()"
          @click="sucheSpeichern"
        >
          Speichern
        </UiButton>
      </template>
    </UiModal>
  </div>
</template>
