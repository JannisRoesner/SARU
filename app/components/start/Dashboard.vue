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
  zuletztVerwendet: MaterialSummary[]
  favoriten: MaterialSummary[]
  zuletztBearbeitet: MaterialSummary[]
  reihen: SeriesSummary[]
  gespeicherteSuchen: { id: string; name: string; query: string }[]
  einrichtung: { ki: boolean; office: boolean }
  kennzahlen: { materialien: number; lehrwerke: number; stunden: number; reihen: number }
}

const { benutzer, darfAnlegen, istAdmin } = useSitzung()
const { data, status, error, refresh } = await useFetch<Dashboard>('/api/dashboard')
const jetzt = useJetzt()

const begruessung = computed(() => {
  const stunde = new Date(jetzt.value).getHours()
  if (stunde < 5) return 'Gute Nacht'
  if (stunde < 11) return 'Guten Morgen'
  if (stunde < 18) return 'Guten Tag'
  return 'Guten Abend'
})

const vorname = computed(() => benutzer.value?.name?.split(' ')[0] ?? '')

const bestand = computed(() => {
  const k = data.value?.kennzahlen
  return (k?.materialien ?? 0) + (k?.lehrwerke ?? 0)
})
const istLeer = computed(() => status.value !== 'pending' && !error.value && bestand.value === 0)

const bestandText = computed(() => {
  const k = data.value?.kennzahlen
  if (!k) return undefined
  const teile = [
    `${formatZahl(k.materialien)} ${k.materialien === 1 ? 'Material' : 'Materialien'}`,
    `${formatZahl(k.lehrwerke)} ${k.lehrwerke === 1 ? 'Lehrwerk' : 'Lehrwerke'}`,
    `${formatZahl(k.reihen)} ${k.reihen === 1 ? 'Reihe' : 'Reihen'}`,
    `${formatZahl(k.stunden)} ${k.stunden === 1 ? 'Stunde' : 'Stunden'}`,
  ]
  return teile.join(' · ')
})

// --- Suche -----------------------------------------------------------------
const suchbegriff = ref('')

async function suchen() {
  const q = suchbegriff.value.trim()
  await navigateTo(q ? { path: '/suche', query: { q } } : '/suche')
}

// --- Erste Schritte --------------------------------------------------------
const AUSBLENDEN_SCHLUESSEL = 'saru-erste-schritte-ausgeblendet'
const bereit = ref(false)
const ausgeblendet = ref(false)

onMounted(() => {
  try {
    ausgeblendet.value = localStorage.getItem(AUSBLENDEN_SCHLUESSEL) === '1'
  } catch {
    /* Speicher nicht verfügbar – Karte bleibt sichtbar. */
  }
  bereit.value = true
})

function ersteSchritteAusblenden() {
  ausgeblendet.value = true
  try {
    localStorage.setItem(AUSBLENDEN_SCHLUESSEL, '1')
  } catch {
    /* ignorieren */
  }
}

const schritte = computed(() => {
  const k = data.value?.kennzahlen
  const e = data.value?.einrichtung
  const alle = [
    {
      id: 'bestand',
      icon: 'file-import',
      titel: 'Material oder Lehrwerk aufnehmen',
      text: 'Einzelne Dateien, ganze Ordner oder Verlags-DVDs importieren.',
      to: '/import',
      erledigt: bestand.value > 0,
      nurAdmin: false,
    },
    {
      id: 'reihe',
      icon: 'layer-group',
      titel: 'Eine Unterrichtsreihe planen',
      text: 'Material aus dem Archiv zu Reihen und Stunden bündeln.',
      to: '/reihen/neu',
      erledigt: (k?.reihen ?? 0) + (k?.stunden ?? 0) > 0,
      nurAdmin: false,
    },
    {
      id: 'ki',
      icon: 'wand-magic-sparkles',
      titel: 'KI-Funktionen einrichten (optional)',
      text: 'Vorschläge für Titel, Schlagwörter und Musterlösungen.',
      to: '/einstellungen/ki',
      erledigt: Boolean(e?.ki),
      nurAdmin: true,
    },
    {
      id: 'office',
      icon: 'file-word',
      titel: 'Office-Vorschau einrichten (optional)',
      text: 'Word- und PowerPoint-Dateien direkt im Browser ansehen.',
      to: '/einstellungen/office',
      erledigt: Boolean(e?.office),
      nurAdmin: true,
    },
  ]
  return alle.filter((s) => !s.nurAdmin || istAdmin.value)
})

const schritteErledigt = computed(() => schritte.value.filter((s) => s.erledigt).length)
const ersteSchritteSichtbar = computed(
  () =>
    darfAnlegen.value &&
    bereit.value &&
    !error.value &&
    status.value !== 'pending' &&
    schritteErledigt.value < schritte.value.length &&
    (istLeer.value || !ausgeblendet.value),
)

const { favoritSetzen } = useMaterialAktionen(() => refresh())

function fachZiel(fach: DashboardFach) {
  if (fach.materialien > 0) return `/materialien?fach=${fach.id}`
  if (fach.lehrwerke > 0) return `/lehrwerke?fach=${fach.id}`
  return '/reihen'
}

function fachZaehlung(fach: DashboardFach) {
  return formatZahl(fach.materialien + fach.lehrwerke + fach.reihen)
}

const listen = computed(() => [
  {
    id: 'verwendet',
    titel: 'Zuletzt verwendet',
    icon: 'clock-rotate-left',
    items: data.value?.zuletztVerwendet ?? [],
    leerIcon: 'clock-rotate-left',
    leerTitel: 'Noch nichts verwendet',
    leerText: 'Hier erscheint Material, das du geöffnet oder im Unterricht eingesetzt hast.',
    alle: '/materialien?sort=zuletzt_verwendet',
  },
  {
    id: 'favoriten',
    icon: 'star',
    titel: 'Favoriten',
    items: data.value?.favoriten ?? [],
    leerIcon: 'star',
    leerTitel: 'Noch keine Favoriten',
    leerText: 'Markiere Material mit dem Stern, um es hier schnell wiederzufinden.',
    alle: '/materialien?favoriten=1',
  },
  {
    id: 'bearbeitet',
    icon: 'pen-to-square',
    titel: 'Zuletzt bearbeitet',
    items: data.value?.zuletztBearbeitet ?? [],
    leerIcon: 'pen-to-square',
    leerTitel: 'Noch nichts vorhanden',
    leerText: 'Neu angelegtes und geändertes Material erscheint hier.',
    alle: '/materialien',
  },
])
</script>

<template>
  <div>
    <LayoutSeitenkopf
      kicker="Übersicht"
      :titel="vorname ? `${begruessung}, ${vorname}` : begruessung"
      :untertitel="bestandText"
    />

    <UiFehlerzustand v-if="error" :text="toApiFehler(error).nachricht" @erneut="refresh()" />

    <div v-else class="flex flex-col gap-5">
      <!-- Suche: das Wichtigste in einem Archiv -->
      <section
        v-if="!istLeer"
        class="rounded-2xl border border-line bg-surface p-4 sm:p-5"
        aria-label="Archiv durchsuchen"
      >
        <form class="flex flex-col gap-2 sm:flex-row" role="search" @submit.prevent="suchen">
          <div class="flex-1">
            <UiInput
              v-model="suchbegriff"
              icon="magnifying-glass"
              placeholder="Im ganzen Archiv suchen – Titel, Inhalte, Schlagwörter …"
              aria-label="Im ganzen Archiv suchen"
            />
          </div>
          <UiButton type="submit" variante="primaer" icon="magnifying-glass">Suchen</UiButton>
        </form>
        <p class="mt-2 text-xs text-ink-subtle">
          Durchsucht auch den Text in PDF- und Word-Dateien.
          <template v-if="data?.gespeicherteSuchen.length">
            Gespeichert:
            <NuxtLink
              v-for="(eintrag, index) in data.gespeicherteSuchen"
              :key="eintrag.id"
              :to="{ path: '/suche', query: { q: eintrag.query } }"
              class="font-medium text-primary hover:underline"
            >{{ eintrag.name }}<template v-if="index < data.gespeicherteSuchen.length - 1">, </template></NuxtLink>
          </template>
        </p>
      </section>

      <!-- Erste Schritte: nur solange etwas offen ist -->
      <UiCard
        v-if="ersteSchritteSichtbar"
        titel="Erste Schritte"
        icon="rocket"
        :untertitel="`${schritteErledigt} von ${schritte.length} erledigt`"
      >
        <template v-if="!istLeer" #kopf>
          <UiButton variante="still" groesse="sm" @click="ersteSchritteAusblenden">Ausblenden</UiButton>
        </template>
        <ul class="grid gap-2 sm:grid-cols-2">
          <li v-for="schritt in schritte" :key="schritt.id">
            <NuxtLink
              :to="schritt.to"
              class="karte karte-klickbar flex h-full items-start gap-3 p-3"
              :class="schritt.erledigt && 'opacity-60'"
            >
              <span
                class="flex size-9 shrink-0 items-center justify-center rounded-xl"
                :class="schritt.erledigt ? 'bg-success-soft text-success' : 'bg-primary-soft text-primary-strong'"
              >
                <UiIcon :name="schritt.erledigt ? 'check' : schritt.icon" fest />
              </span>
              <span class="min-w-0">
                <span class="block font-medium text-ink">{{ schritt.titel }}</span>
                <span class="block text-xs text-ink-muted">{{ schritt.text }}</span>
              </span>
            </NuxtLink>
          </li>
        </ul>
      </UiCard>

      <UiLeerzustand
        v-if="istLeer && !darfAnlegen"
        icon="book"
        titel="Das Archiv ist noch leer"
        text="Sobald Lehrwerke und Material aufgenommen sind, findest du sie hier."
      />

      <template v-if="!istLeer">
        <!-- Weiterarbeiten -->
        <div class="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-3">
          <UiCard v-for="liste in listen" :key="liste.id" :titel="liste.titel" :icon="liste.icon" class="h-full">
            <template #kopf>
              <UiButton :to="liste.alle" variante="still" groesse="sm" icon-rechts="arrow-right">
                Alle
              </UiButton>
            </template>

            <UiSkelett v-if="status === 'pending'" art="liste" :zeilen="3" />
            <div
              v-else-if="!liste.items.length"
              class="flex min-h-[9rem] items-center justify-center"
            >
              <UiLeerzustand klein :icon="liste.leerIcon" :titel="liste.leerTitel" :text="liste.leerText" />
            </div>
            <div v-else class="space-y-2">
              <MaterialKarte
                v-for="material in liste.items"
                :key="material.id"
                :material="material"
                kompakt
                @favorit="favoritSetzen"
              />
            </div>
          </UiCard>
        </div>

        <!-- Stöbern nach Fach -->
        <UiCard v-if="data?.faecher.length" titel="Nach Fach stöbern" icon="palette">
          <div class="flex flex-wrap gap-2">
            <NuxtLink
              v-for="fach in data.faecher"
              :key="fach.id"
              :to="fachZiel(fach)"
              class="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-ink transition-colors hover:border-primary hover:bg-primary-soft"
            >
              <span class="size-2.5 rounded-full" :style="{ backgroundColor: fach.color }" />
              {{ fach.name }}
              <span class="text-xs text-ink-subtle tabular-nums">{{ fachZaehlung(fach) }}</span>
            </NuxtLink>
          </div>
        </UiCard>

        <!-- Aktuelle Reihen (nur wenn es welche gibt) -->
        <UiCard v-if="data?.reihen.length" titel="Aktuelle Reihen" icon="layer-group">
          <template #kopf>
            <UiButton to="/reihen" variante="still" groesse="sm" icon-rechts="arrow-right">Alle</UiButton>
          </template>
          <div class="grid gap-3 md:grid-cols-2">
            <ReiheKarte v-for="reihe in data.reihen" :key="reihe.id" :reihe="reihe" />
          </div>
        </UiCard>
      </template>
    </div>
  </div>
</template>
