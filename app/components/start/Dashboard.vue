<script setup lang="ts">
import type { LessonSummary } from '~~/server/repositories/lesson.repository'
import type { MaterialSummary } from '~~/server/repositories/material.repository'
import type { SeriesSummary } from '~~/server/repositories/series.repository'

interface Dashboard {
  zuletztBearbeitet: MaterialSummary[]
  favoriten: MaterialSummary[]
  naechsteStunden: LessonSummary[]
  aktiveReihen: SeriesSummary[]
  kennzahlen: {
    materialien: number
    stunden: number
    reihen: number
    anhaenge: number
    kiLoesungen: number
  }
}

const { benutzer, darfBearbeiten } = useSitzung()
const { data, status, error, refresh } = await useFetch<Dashboard>('/api/dashboard')

const begruessung = computed(() => {
  const stunde = new Date().getHours()
  if (stunde < 5) return 'Gute Nacht'
  if (stunde < 11) return 'Guten Morgen'
  if (stunde < 18) return 'Guten Tag'
  return 'Guten Abend'
})

const vorname = computed(() => benutzer.value?.name?.split(' ')[0] ?? '')

const kennzahlen = computed(() => {
  const k = data.value?.kennzahlen
  return [
    { label: 'Materialien', wert: k?.materialien ?? 0, icon: 'folder-open', to: '/materialien' },
    { label: 'Unterrichtsstunden', wert: k?.stunden ?? 0, icon: 'chalkboard-user', to: '/stunden' },
    { label: 'Reihen', wert: k?.reihen ?? 0, icon: 'layer-group', to: '/reihen' },
    { label: 'Anhänge', wert: k?.anhaenge ?? 0, icon: 'paperclip', to: '/materialien?hatDateien=1' },
  ]
})

const schnellaktionen = [
  { label: 'Material anlegen', icon: 'plus', to: '/materialien/neu', variante: 'primaer' as const },
  { label: 'Stunde planen', icon: 'calendar-plus', to: '/stunden/neu', variante: 'sekundaer' as const },
  { label: 'Reihe starten', icon: 'layer-group', to: '/reihen/neu', variante: 'sekundaer' as const },
  { label: 'Import aus SchulPortal', icon: 'file-import', to: '/import', variante: 'still' as const },
]

const { favoritSetzen } = useMaterialAktionen(() => refresh())
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="seitenkopf-kicker">Übersicht</p>
        <h1 class="text-3xl tracking-tight text-ink">
          {{ begruessung }}<template v-if="vorname">, {{ vorname }}</template>
        </h1>
        <p class="mt-1 text-sm text-ink-muted">
          {{ new Date().toLocaleDateString('de-DE', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
          }) }}
        </p>
      </div>

      <div v-if="darfBearbeiten" class="flex flex-wrap gap-2">
        <UiButton
          v-for="aktion in schnellaktionen"
          :key="aktion.to"
          :to="aktion.to"
          :variante="aktion.variante"
          :icon="aktion.icon"
        >
          {{ aktion.label }}
        </UiButton>
      </div>
    </header>

    <UiFehlerzustand v-if="error" :text="toApiFehler(error).nachricht" @erneut="refresh()" />

    <template v-else>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <NuxtLink
          v-for="zahl in kennzahlen"
          :key="zahl.label"
          :to="zahl.to"
          class="karte flex items-center gap-3 p-4 transition-shadow hover:shadow-md"
        >
          <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
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

      <div class="grid gap-6 xl:grid-cols-3">
        <section class="space-y-3 xl:col-span-2">
          <div class="flex items-center justify-between">
            <h2 class="flex items-center gap-2 text-ink">
              <UiIcon name="clock-rotate-left" class="text-ink-subtle" />
              Zuletzt bearbeitet
            </h2>
            <NuxtLink to="/materialien" class="text-sm text-primary hover:underline">
              Alle Materialien
            </NuxtLink>
          </div>

          <UiSkelett v-if="status === 'pending'" art="list" :zeilen="4" />
          <UiLeerzustand
            v-else-if="!data?.zuletztBearbeitet.length"
            klein
            icon="folder-open"
            titel="Noch keine Materialien"
            text="Lege dein erstes Material an oder importiere einen Export aus dem SchulPortal."
          >
            <UiButton v-if="darfBearbeiten" to="/materialien/neu" variante="primaer" icon="plus">
              Material anlegen
            </UiButton>
          </UiLeerzustand>
          <div v-else class="space-y-2">
            <MaterialKarte
              v-for="material in data.zuletztBearbeitet"
              :key="material.id"
              :material="material"
              kompakt
              @favorit="favoritSetzen"
            />
          </div>
        </section>

        <section class="space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="flex items-center gap-2 text-ink">
              <UiIcon name="calendar-day" class="text-ink-subtle" />
              Anstehende Stunden
            </h2>
            <NuxtLink to="/stunden" class="text-sm text-primary hover:underline">Alle</NuxtLink>
          </div>

          <UiSkelett v-if="status === 'pending'" art="list" :zeilen="3" />
          <UiLeerzustand
            v-else-if="!data?.naechsteStunden.length"
            klein
            icon="calendar-check"
            titel="Keine Stunden geplant"
            text="Für die kommenden Tage ist nichts eingetragen."
          />
          <div v-else class="space-y-2">
            <StundeKarte
              v-for="stunde in data.naechsteStunden"
              :key="stunde.id"
              :stunde="stunde"
              kompakt
            />
          </div>
        </section>
      </div>

      <div class="grid gap-6 xl:grid-cols-2">
        <section class="space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="flex items-center gap-2 text-ink">
              <UiIcon name="layer-group" class="text-ink-subtle" />
              Aktive Reihen
            </h2>
            <NuxtLink to="/reihen" class="text-sm text-primary hover:underline">Alle</NuxtLink>
          </div>

          <UiSkelett v-if="status === 'pending'" art="cards" :zeilen="2" />
          <UiLeerzustand
            v-else-if="!data?.aktiveReihen.length"
            klein
            icon="layer-group"
            titel="Keine laufende Reihe"
            text="Bündele zusammengehörige Stunden zu einer Unterrichtsreihe."
          >
            <UiButton v-if="darfBearbeiten" to="/reihen/neu" variante="sekundaer" icon="plus">
              Reihe anlegen
            </UiButton>
          </UiLeerzustand>
          <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <ReiheKarte v-for="reihe in data.aktiveReihen" :key="reihe.id" :reihe="reihe" />
          </div>
        </section>

        <section class="space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="flex items-center gap-2 text-ink">
              <UiIcon name="star" class="text-ink-subtle" />
              Favoriten
            </h2>
            <NuxtLink to="/materialien?favoriten=1" class="text-sm text-primary hover:underline">
              Alle
            </NuxtLink>
          </div>

          <UiSkelett v-if="status === 'pending'" art="list" :zeilen="3" />
          <UiLeerzustand
            v-else-if="!data?.favoriten.length"
            klein
            icon="star"
            titel="Noch keine Favoriten"
            text="Markiere häufig genutzte Materialien mit dem Stern, um sie hier wiederzufinden."
          />
          <div v-else class="space-y-2">
            <MaterialKarte
              v-for="material in data.favoriten"
              :key="material.id"
              :material="material"
              kompakt
              @favorit="favoritSetzen"
            />
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
