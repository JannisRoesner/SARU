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
  { label: 'Stunde anlegen', icon: 'calendar-plus', to: '/stunden/neu', variante: 'sekundaer' as const },
  { label: 'Reihe anlegen', icon: 'layer-group', to: '/reihen/neu', variante: 'sekundaer' as const },
  { label: 'Import aus SchulPortal', icon: 'file-import', to: '/import', variante: 'sekundaer' as const },
]

const { favoritSetzen } = useMaterialAktionen(() => refresh())
</script>

<template>
  <div>
    <LayoutSeitenkopf
      kicker="Übersicht"
      :titel="vorname ? `${begruessung}, ${vorname}` : begruessung"
      :untertitel="new Date().toLocaleDateString('de-DE', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })"
    >
      <template v-if="darfBearbeiten" #aktionen>
        <UiButton
          v-for="aktion in schnellaktionen"
          :key="aktion.to"
          :to="aktion.to"
          :variante="aktion.variante"
          :icon="aktion.icon"
          groesse="sm"
        >
          {{ aktion.label }}
        </UiButton>
      </template>
    </LayoutSeitenkopf>

    <UiFehlerzustand v-if="error" :text="toApiFehler(error).nachricht" @erneut="refresh()" />

    <div v-else class="flex flex-col gap-4">
      <!-- Kennzahlen und Abschnitte teilen gap-4; auf xl bilden 2 Abschnitte eine 4er-Zeile -->
      <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
        <UiCard titel="Zuletzt bearbeitet" icon="clock-rotate-left" class="h-full">
          <template #kopf>
            <UiButton to="/materialien" variante="still" groesse="sm" icon-rechts="arrow-right">
              Alle
            </UiButton>
          </template>

          <UiSkelett v-if="status === 'pending'" art="list" :zeilen="2" />
          <div
            v-else-if="!data?.zuletztBearbeitet.length"
            class="flex min-h-[11rem] items-center justify-center"
          >
            <UiLeerzustand
              klein
              icon="folder-open"
              titel="Noch keine Materialien"
              text="Lege dein erstes Material an oder importiere einen Export aus dem SchulPortal."
            >
              <UiButton v-if="darfBearbeiten" to="/materialien/neu" variante="primaer" groesse="sm" icon="plus">
                Material anlegen
              </UiButton>
            </UiLeerzustand>
          </div>
          <div v-else class="space-y-2">
            <MaterialKarte
              v-for="material in data.zuletztBearbeitet"
              :key="material.id"
              :material="material"
              kompakt
              @favorit="favoritSetzen"
            />
          </div>
        </UiCard>

        <UiCard titel="Anstehende Stunden" icon="calendar-day" class="h-full">
          <template #kopf>
            <UiButton to="/stunden" variante="still" groesse="sm" icon-rechts="arrow-right">
              Alle
            </UiButton>
          </template>

          <UiSkelett v-if="status === 'pending'" art="list" :zeilen="3" />
          <div
            v-else-if="!data?.naechsteStunden.length"
            class="flex min-h-[11rem] items-center justify-center"
          >
            <UiLeerzustand
              klein
              icon="calendar-check"
              titel="Keine Stunden geplant"
              text="Für die kommenden Tage ist nichts eingetragen."
            >
              <UiButton v-if="darfBearbeiten" to="/stunden/neu" variante="sekundaer" groesse="sm" icon="plus">
                Stunde anlegen
              </UiButton>
            </UiLeerzustand>
          </div>
          <div v-else class="space-y-2">
            <StundeKarte
              v-for="stunde in data.naechsteStunden"
              :key="stunde.id"
              :stunde="stunde"
              kompakt
            />
          </div>
        </UiCard>

        <UiCard titel="Aktive Reihen" icon="layer-group" class="h-full">
          <template #kopf>
            <UiButton to="/reihen" variante="still" groesse="sm" icon-rechts="arrow-right">
              Alle
            </UiButton>
          </template>

          <UiSkelett v-if="status === 'pending'" art="cards" :zeilen="2" />
          <div
            v-else-if="!data?.aktiveReihen.length"
            class="flex min-h-[11rem] items-center justify-center"
          >
            <UiLeerzustand
              klein
              icon="layer-group"
              titel="Keine laufende Reihe"
              text="Bündele zusammengehörige Stunden zu einer Unterrichtsreihe."
            >
              <UiButton v-if="darfBearbeiten" to="/reihen/neu" variante="sekundaer" groesse="sm" icon="plus">
                Reihe anlegen
              </UiButton>
            </UiLeerzustand>
          </div>
          <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <ReiheKarte v-for="reihe in data.aktiveReihen" :key="reihe.id" :reihe="reihe" />
          </div>
        </UiCard>

        <UiCard titel="Favoriten" icon="star" class="h-full">
          <template #kopf>
            <UiButton to="/materialien?favoriten=1" variante="still" groesse="sm" icon-rechts="arrow-right">
              Alle
            </UiButton>
          </template>

          <UiSkelett v-if="status === 'pending'" art="list" :zeilen="3" />
          <div
            v-else-if="!data?.favoriten.length"
            class="flex min-h-[11rem] items-center justify-center"
          >
            <UiLeerzustand
              klein
              icon="star"
              titel="Noch keine Favoriten"
              text="Markiere häufig genutzte Materialien mit dem Stern, um sie hier wiederzufinden."
            />
          </div>
          <div v-else class="space-y-2">
            <MaterialKarte
              v-for="material in data.favoriten"
              :key="material.id"
              :material="material"
              kompakt
              @favorit="favoritSetzen"
            />
          </div>
        </UiCard>
      </div>
    </div>
  </div>
</template>
