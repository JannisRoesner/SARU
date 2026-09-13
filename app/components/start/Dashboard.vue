<script setup lang="ts">
import type { MaterialSummary } from '~~/server/repositories/material.repository'
import type { SeriesSummary } from '~~/server/repositories/series.repository'

interface DashboardFach {
  id: string
  name: string
  color: string
  materialien: number
  lehrwerke: number
  reihen: number
}

interface Dashboard {
  faecher: DashboardFach[]
  lehrwerke: MaterialSummary[]
  materialien: MaterialSummary[]
  reihen: SeriesSummary[]
  kennzahlen: {
    materialien: number
    lehrwerke: number
    stunden: number
    reihen: number
    anhaenge: number
    kiLoesungen: number
  }
}

const { benutzer, darfBearbeiten } = useSitzung()
const { data, status, error, refresh } = await useFetch<Dashboard>('/api/dashboard')
const jetzt = useJetzt()

const begruessung = computed(() => {
  const stunde = new Date(jetzt.value).getHours()
  if (stunde < 5) return 'Gute Nacht'
  if (stunde < 11) return 'Guten Morgen'
  if (stunde < 18) return 'Guten Tag'
  return 'Guten Abend'
})

const heutigesDatum = computed(() =>
  new Date(jetzt.value).toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }),
)

const vorname = computed(() => benutzer.value?.name?.split(' ')[0] ?? '')

const kennzahlen = computed(() => {
  const k = data.value?.kennzahlen
  const lehrwerke = k?.lehrwerke ?? 0
  const materialien = k?.materialien ?? 0
  const reihen = k?.reihen ?? 0
  const faecher = data.value?.faecher.length ?? 0
  return [
    { label: lehrwerke === 1 ? 'Lehrwerk' : 'Lehrwerke', wert: lehrwerke, icon: 'book', to: '/lehrwerke' },
    { label: materialien === 1 ? 'Material' : 'Materialien', wert: materialien, icon: 'folder-open', to: '/materialien' },
    { label: reihen === 1 ? 'Reihe' : 'Reihen', wert: reihen, icon: 'layer-group', to: '/reihen' },
    { label: faecher === 1 ? 'Fach' : 'Fächer', wert: faecher, icon: 'palette', to: '/materialien' },
  ]
})

const schnellaktionen = [
  { label: 'Material anlegen', kurz: 'Material', icon: 'plus', to: '/materialien/neu', variante: 'primaer' as const },
  { label: 'Stunde anlegen', kurz: 'Stunde', icon: 'calendar-plus', to: '/stunden/neu', variante: 'sekundaer' as const },
  { label: 'Reihe anlegen', kurz: 'Reihe', icon: 'layer-group', to: '/reihen/neu', variante: 'sekundaer' as const },
  { label: 'Import aus Schulportal', kurz: 'Import', icon: 'file-import', to: '/import', variante: 'sekundaer' as const },
]

const { favoritSetzen } = useMaterialAktionen(() => refresh())

function fachZiel(fach: DashboardFach) {
  if (fach.materialien > 0) return `/materialien?fach=${fach.id}`
  if (fach.lehrwerke > 0) return `/lehrwerke?fach=${fach.id}`
  return '/reihen'
}

function fachZaehlung(fach: DashboardFach) {
  const teile: string[] = []
  if (fach.lehrwerke) {
    teile.push(`${formatZahl(fach.lehrwerke)} ${fach.lehrwerke === 1 ? 'Lehrwerk' : 'Lehrwerke'}`)
  }
  if (fach.materialien) {
    teile.push(`${formatZahl(fach.materialien)} ${fach.materialien === 1 ? 'Material' : 'Materialien'}`)
  }
  if (fach.reihen) {
    teile.push(`${formatZahl(fach.reihen)} ${fach.reihen === 1 ? 'Reihe' : 'Reihen'}`)
  }
  return teile.join(' · ')
}
</script>

<template>
  <div>
    <LayoutSeitenkopf
      kicker="Übersicht"
      :titel="vorname ? `${begruessung}, ${vorname}` : begruessung"
      :untertitel="heutigesDatum"
    />

    <div
      v-if="darfBearbeiten"
      class="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4"
    >
      <UiButton
        v-for="aktion in schnellaktionen"
        :key="aktion.to"
        :to="aktion.to"
        :variante="aktion.variante"
        :icon="aktion.icon"
        :title="aktion.label"
        groesse="sm"
        breit
      >
        <span class="truncate sm:hidden">{{ aktion.kurz }}</span>
        <span class="hidden truncate sm:inline">{{ aktion.label }}</span>
      </UiButton>
    </div>

    <UiFehlerzustand v-if="error" :text="toApiFehler(error).nachricht" @erneut="refresh()" />

    <div v-else class="flex flex-col gap-4">
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <NuxtLink
          v-for="zahl in kennzahlen"
          :key="zahl.label"
          :to="zahl.to"
          class="karte karte-klickbar flex items-center gap-3 p-4"
        >
          <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-strong">
            <UiIcon :name="zahl.icon" fest />
          </span>
          <span class="min-w-0">
            <span class="block text-xl font-semibold tabular-nums text-ink">
              {{ formatZahl(zahl.wert) }}
            </span>
            <span class="block truncate text-xs text-ink-muted">{{ zahl.label }}</span>
          </span>
        </NuxtLink>
      </div>

      <div class="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-2">
        <UiCard titel="Fächer" icon="palette" class="h-full">
          <template #kopf>
            <UiButton to="/materialien" variante="still" groesse="sm" icon-rechts="arrow-right">
              Alle
            </UiButton>
          </template>

          <UiSkelett v-if="status === 'pending'" art="karten" :zeilen="2" />
          <div
            v-else-if="!data?.faecher.length"
            class="flex min-h-[11rem] items-center justify-center"
          >
            <UiLeerzustand
              klein
              icon="palette"
              titel="Noch keine Fächer"
              text="Noch keine Zuordnungen."
            />
          </div>
          <div v-else class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <NuxtLink
              v-for="fach in data.faecher"
              :key="fach.id"
              :to="fachZiel(fach)"
              class="karte karte-klickbar flex items-center gap-3 p-3"
            >
              <span
                class="flex size-10 shrink-0 items-center justify-center rounded-xl"
                :style="{ backgroundColor: `${fach.color}22`, color: fach.color }"
              >
                <UiIcon name="palette" fest />
              </span>
              <span class="min-w-0">
                <span class="block truncate font-medium text-ink">{{ fach.name }}</span>
                <span class="block truncate text-xs text-ink-muted">{{ fachZaehlung(fach) }}</span>
              </span>
            </NuxtLink>
          </div>
        </UiCard>

        <UiCard titel="Lehrwerke" icon="book" class="h-full">
          <template #kopf>
            <UiButton to="/lehrwerke" variante="still" groesse="sm" icon-rechts="arrow-right">
              Alle
            </UiButton>
          </template>

          <UiSkelett v-if="status === 'pending'" art="liste" :zeilen="3" />
          <div
            v-else-if="!data?.lehrwerke.length"
            class="flex min-h-[11rem] items-center justify-center"
          >
            <UiLeerzustand
              klein
              icon="book"
              titel="Noch keine Lehrwerke"
              text="Noch keines vorhanden."
            >
              <UiButton v-if="darfBearbeiten" to="/lehrwerke/neu" variante="primaer" groesse="sm" icon="plus">
                Lehrwerk anlegen
              </UiButton>
            </UiLeerzustand>
          </div>
          <div v-else class="space-y-2">
            <MaterialKarte
              v-for="lehrwerk in data.lehrwerke"
              :key="lehrwerk.id"
              :material="lehrwerk"
              kompakt
              @favorit="favoritSetzen"
            />
          </div>
        </UiCard>

        <UiCard titel="Materialien" icon="folder-open" class="h-full">
          <template #kopf>
            <UiButton to="/materialien" variante="still" groesse="sm" icon-rechts="arrow-right">
              Alle
            </UiButton>
          </template>

          <UiSkelett v-if="status === 'pending'" art="liste" :zeilen="3" />
          <div
            v-else-if="!data?.materialien.length"
            class="flex min-h-[11rem] items-center justify-center"
          >
            <UiLeerzustand
              klein
              icon="folder-open"
              titel="Noch keine Materialien"
              text="Noch keines vorhanden."
            >
              <UiButton v-if="darfBearbeiten" to="/materialien/neu" variante="primaer" groesse="sm" icon="plus">
                Material anlegen
              </UiButton>
            </UiLeerzustand>
          </div>
          <div v-else class="space-y-2">
            <MaterialKarte
              v-for="material in data.materialien"
              :key="material.id"
              :material="material"
              kompakt
              @favorit="favoritSetzen"
            />
          </div>
        </UiCard>

        <UiCard titel="Reihen" icon="layer-group" class="h-full">
          <template #kopf>
            <UiButton to="/reihen" variante="still" groesse="sm" icon-rechts="arrow-right">
              Alle
            </UiButton>
          </template>

          <UiSkelett v-if="status === 'pending'" art="karten" :zeilen="2" />
          <div
            v-else-if="!data?.reihen.length"
            class="flex min-h-[11rem] items-center justify-center"
          >
            <UiLeerzustand
              klein
              icon="layer-group"
              titel="Noch keine Reihen"
              text="Noch keine vorhanden."
            >
              <UiButton v-if="darfBearbeiten" to="/reihen/neu" variante="sekundaer" groesse="sm" icon="plus">
                Reihe anlegen
              </UiButton>
            </UiLeerzustand>
          </div>
          <div v-else class="space-y-3">
            <ReiheKarte v-for="reihe in data.reihen" :key="reihe.id" :reihe="reihe" />
          </div>
        </UiCard>
      </div>
    </div>
  </div>
</template>
