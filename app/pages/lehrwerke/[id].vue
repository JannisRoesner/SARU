<script setup lang="ts">
import { materialTypes } from '#shared/utils/labels'
import { gruppiereLehrwerkInhalt } from '#shared/utils/lehrwerk'
import { materialPfad } from '#shared/utils/material-pfad'
import type {
  LehrwerkInhaltItem,
  MaterialDetail,
  MaterialSummary,
} from '~~/server/repositories/material.repository'

const route = useRoute()
const id = computed(() => String(route.params.id))
const { darfBearbeiten } = useSitzung()
const { aufruf } = useApi()

const { data, status, error, refresh } = await useFetch<MaterialDetail>(
  () => `/api/materials/${id.value}`,
)

const { data: inhaltDaten, refresh: inhaltLaden } = await useFetch<{ items: LehrwerkInhaltItem[] }>(
  () => `/api/materials/${id.value}/inhalt`,
  { default: () => ({ items: [] }) },
)

useHead({ title: () => data.value?.title ?? 'Lehrwerk' })

watch(
  data,
  (wert) => {
    if (wert && wert.materialType !== 'lehrwerk') {
      void navigateTo(materialPfad(wert), { replace: true })
    }
  },
  { immediate: true },
)

const {
  favoritSetzen,
  alsVerwendetMerken,
  loeschen,
} = useMaterialAktionen(() => Promise.all([refresh(), inhaltLaden()]))

const loeschenOffen = ref(false)

async function lehrwerkLoeschen() {
  const ok = await loeschen(id.value, 'Lehrwerk gelöscht.')
  loeschenOffen.value = false
  if (ok) await navigateTo('/lehrwerke')
}

const inhalt = computed(() => inhaltDaten.value?.items ?? [])
const inhaltSuche = ref('')
const pickerOffen = ref(false)
const vorschauOffen = ref(false)
const vorschauAssetId = ref<string | null>(null)
const vorschauTitel = ref<string | null>(null)
const ziehe = ref(false)
const dateiInput = ref<HTMLInputElement | null>(null)
const ersetzenInput = ref<HTMLInputElement | null>(null)

const gefilterterInhalt = computed(() => {
  const q = inhaltSuche.value.trim().toLowerCase()
  if (!q) return inhalt.value
  return inhalt.value.filter((item) => {
    const typ = materialTypes.label(item.materialType).toLowerCase()
    return item.title.toLowerCase().includes(q) || typ.includes(q)
  })
})

const gruppen = computed(() => gruppiereLehrwerkInhalt(gefilterterInhalt.value))

const bereitsZugeordnet = computed(() => [id.value, ...inhalt.value.map((item) => item.id)])

const standardVariante = computed(
  () => data.value?.variants.find((v) => v.isDefault) ?? data.value?.variants[0] ?? null,
)

const hauptVorschau = computed(() => {
  const varianten = data.value?.variants ?? []
  for (const variante of [...varianten].sort(
    (a, b) => Number(b.isDefault) - Number(a.isDefault) || a.sortOrder - b.sortOrder,
  )) {
    const asset = variante.assets.find((a) => a.kind === 'datei')
    if (asset) return asset
  }
  return null
})

const weitereBuchdateien = computed(() => {
  const hauptId = hauptVorschau.value?.id
  return (standardVariante.value?.assets ?? []).filter((asset) => asset.id !== hauptId)
})

function assetOeffnen(asset: {
  id: string
  kind: string
  url: string | null
  title?: string | null
  fileName?: string | null
}) {
  void alsVerwendetMerken(id.value)
  if (asset.kind === 'link' && asset.url) {
    window.open(asset.url, '_blank', 'noopener')
    return
  }
  vorschauAssetId.value = asset.id
  vorschauTitel.value = asset.title || asset.fileName || null
  vorschauOffen.value = true
}

function assetHerunterladen(assetId: string) {
  void alsVerwendetMerken(id.value)
  window.open(`/api/assets/${assetId}/download`, '_blank')
}

async function buchHochladen(files: FileList | null) {
  const file = files?.[0]
  if (!file || !standardVariante.value || hauptVorschau.value) return
  const body = new FormData()
  body.append('files', file)
  body.append('role', 'haupt')
  const ergebnis = await aufruf(`/api/variants/${standardVariante.value.id}/uploads`, {
    method: 'POST',
    body,
    erfolgsmeldung: 'Buchdatei hochgeladen.',
  })
  if (dateiInput.value) dateiInput.value.value = ''
  if (ergebnis) await refresh()
}

async function buchErsetzen(files: FileList | null) {
  const file = files?.[0]
  const alt = hauptVorschau.value
  if (!file || !standardVariante.value || !alt) return
  const geloescht = await aufruf(`/api/assets/${alt.id}`, {
    method: 'DELETE',
  })
  if (ersetzenInput.value) ersetzenInput.value.value = ''
  if (geloescht === null) return
  await refresh()
  const body = new FormData()
  body.append('files', file)
  body.append('role', 'haupt')
  const ergebnis = await aufruf(`/api/variants/${standardVariante.value.id}/uploads`, {
    method: 'POST',
    body,
    erfolgsmeldung: 'Buchdatei ersetzt.',
  })
  if (ergebnis) await refresh()
}

async function buchEntfernen() {
  if (!hauptVorschau.value) return
  const ok = await aufruf(`/api/assets/${hauptVorschau.value.id}`, {
    method: 'DELETE',
    erfolgsmeldung: 'Buchdatei entfernt.',
  })
  if (ok !== null) await refresh()
}

async function extraDateiEntfernen(assetId: string) {
  const ok = await aufruf(`/api/assets/${assetId}`, {
    method: 'DELETE',
    erfolgsmeldung: 'Datei entfernt.',
  })
  if (ok !== null) await refresh()
}

async function materialZuordnen(material: MaterialSummary) {
  const ergebnis = await aufruf(`/api/materials/${id.value}/relations`, {
    method: 'POST',
    body: {
      targetId: material.id,
      relationType: 'gehoert_zu',
      direction: 'eingehend',
    },
    erfolgsmeldung: 'Material zugeordnet.',
  })
  if (ergebnis) {
    await Promise.all([refresh(), inhaltLaden()])
  }
}

async function zuordnungLoesen(relationId: string) {
  const ok = await aufruf(`/api/relations/${relationId}`, {
    method: 'DELETE',
    erfolgsmeldung: 'Zuordnung entfernt.',
  })
  if (ok !== null) await Promise.all([refresh(), inhaltLaden()])
}
</script>

<template>
  <div>
    <UiFehlerzustand v-if="error" :text="toApiFehler(error).nachricht" @erneut="refresh()" />
    <UiSkelett v-else-if="status === 'pending' || !data" art="liste" :zeilen="8" />

    <template v-else-if="data.materialType === 'lehrwerk'">
      <div class="mb-2">
        <NuxtLink
          to="/lehrwerke"
          class="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary"
        >
          <UiIcon name="arrow-left" fest /> Lehrwerke
        </NuxtLink>
      </div>

      <header class="mb-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div class="min-w-0 max-w-3xl">
          <p class="seitenkopf-kicker">Lehrwerk</p>
          <h1 class="break-words text-3xl tracking-tight text-ink">{{ data.title }}</h1>
          <p v-if="data.description" class="mt-2 text-sm leading-relaxed text-ink-muted">
            {{ data.description }}
          </p>
          <div class="mt-3 flex flex-wrap gap-1.5">
            <UiBadge
              v-for="fach in data.subjects"
              :key="fach.id"
              :farbe="fach.color ?? undefined"
            >
              {{ fach.name }}
            </UiBadge>
            <UiBadge v-if="data.gradeLevels.length">
              {{ formatJahrgaenge(data.gradeLevels) }}
            </UiBadge>
            <UiBadge v-if="data.source" icon="quote-left">{{ data.source }}</UiBadge>
            <UiBadge icon="layer-group">
              {{ formatZahl(inhalt.length) }}
              {{ inhalt.length === 1 ? 'Material' : 'Materialien' }}
            </UiBadge>
            <UiBadge v-if="data.isArchived" icon="box-archive">Archiviert</UiBadge>
          </div>
        </div>

        <LayoutAktionen class="sm:ml-auto sm:justify-end">
          <UiButton
            variante="still"
            :icon="data.isFavorite ? 'star' : 'star'"
            nur-icon
            :title="data.isFavorite ? 'Favorit entfernen' : 'Als Favorit'"
            @click="favoritSetzen(data.id, !data.isFavorite)"
          />
          <UiButton
            v-if="darfBearbeiten"
            variante="sekundaer"
            icon="plus"
            @click="pickerOffen = true"
          >
            Material zuordnen
          </UiButton>
          <UiButton :to="`/materialien/${data.id}`" variante="still" icon="pen-to-square">
            Angaben
          </UiButton>
          <UiButton
            v-if="darfBearbeiten"
            variante="gefahr"
            icon="trash"
            nur-icon
            title="Löschen"
            @click="loeschenOffen = true"
          />
        </LayoutAktionen>
      </header>

      <div class="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <UiCard
          titel="Schulbuch"
          untertitel="Genau eine Buchdatei. Lösungsheft, Serviceband und Arbeitsblätter liegen als zugeordnete Materialien daneben."
          icon="book"
        >
          <div v-if="hauptVorschau" class="space-y-4">
            <div class="flex items-start gap-4">
              <MaterialVorschauMiniatur
                :asset-id="hauptVorschau.id"
                :file-name="hauptVorschau.fileName"
                :mime-type="hauptVorschau.mimeType"
                material-type="lehrwerk"
                groesse="lg"
                klickbar
                @klick="assetOeffnen(hauptVorschau)"
              />
              <div class="min-w-0 flex-1 space-y-3">
                <div>
                  <p class="font-medium text-ink">
                    {{ hauptVorschau.title || hauptVorschau.fileName }}
                  </p>
                  <p v-if="hauptVorschau.sizeBytes" class="text-sm text-ink-muted">
                    {{ formatBytes(hauptVorschau.sizeBytes) }}
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <UiButton variante="primaer" icon="eye" @click="assetOeffnen(hauptVorschau)">
                    Öffnen
                  </UiButton>
                  <UiButton
                    variante="sekundaer"
                    icon="download"
                    @click="assetHerunterladen(hauptVorschau.id)"
                  >
                    Laden
                  </UiButton>
                  <template v-if="darfBearbeiten">
                    <input
                      ref="ersetzenInput"
                      type="file"
                      class="sr-only"
                      @change="buchErsetzen(($event.target as HTMLInputElement).files)"
                    >
                    <UiButton
                      variante="sekundaer"
                      icon="rotate-right"
                      @click="ersetzenInput?.click()"
                    >
                      Ersetzen
                    </UiButton>
                    <UiButton
                      variante="still"
                      icon="trash"
                      nur-icon
                      title="Buchdatei entfernen"
                      @click="buchEntfernen"
                    />
                  </template>
                </div>
              </div>
            </div>

            <ul v-if="weitereBuchdateien.length" class="space-y-1.5">
              <li
                v-for="asset in weitereBuchdateien"
                :key="asset.id"
                class="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"
              >
                <UiIcon name="paperclip" fest class="text-ink-subtle" />
                <button
                  type="button"
                  class="min-w-0 flex-1 truncate text-left font-medium hover:text-primary"
                  @click="assetOeffnen(asset)"
                >
                  {{ asset.title || asset.fileName || 'Datei' }}
                </button>
                <UiButton
                  v-if="darfBearbeiten"
                  variante="still"
                  groesse="sm"
                  icon="trash"
                  nur-icon
                  title="Datei entfernen"
                  @click="extraDateiEntfernen(asset.id)"
                />
              </li>
            </ul>
          </div>

          <UiLeerzustand
            v-else
            klein
            icon="book"
            titel="Noch keine Buchdatei"
            text="Lade die PDF des Schülerbuchs hier hoch."
          />

          <label
            v-if="darfBearbeiten && !hauptVorschau"
            class="mt-4 flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors"
            :class="ziehe ? 'border-primary bg-primary-soft/40' : 'border-line'"
            @dragover.prevent="ziehe = true"
            @dragleave.prevent="ziehe = false"
            @drop.prevent="ziehe = false; buchHochladen(($event as DragEvent).dataTransfer?.files ?? null)"
          >
            <input
              ref="dateiInput"
              type="file"
              class="sr-only"
              @change="buchHochladen(($event.target as HTMLInputElement).files)"
            >
            <UiIcon name="cloud-arrow-up" class="mb-2 text-xl text-primary" />
            <span class="text-sm font-medium text-ink">Buchdatei hochladen</span>
          </label>
        </UiCard>

        <div class="min-w-0 space-y-5">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div class="flex-1">
              <UiField>
                <UiInput
                  v-model="inhaltSuche"
                  icon="magnifying-glass"
                  placeholder="Zugeordnete Materialien eingrenzen …"
                  aria-label="Lehrwerkinhalt eingrenzen"
                />
              </UiField>
            </div>
            <UiButton
              v-if="darfBearbeiten"
              variante="sekundaer"
              icon="plus"
              @click="pickerOffen = true"
            >
              Zuordnen
            </UiButton>
          </div>

          <UiLeerzustand
            v-if="!inhalt.length"
            icon="layer-group"
            titel="Noch nichts zugeordnet"
            text="Ordne Lösungsheft, Serviceband, Kopiervorlagen und andere Materialien diesem Lehrwerk zu. Beim Stapel-Upload geht das automatisch."
          >
            <UiButton
              v-if="darfBearbeiten"
              variante="primaer"
              icon="plus"
              @click="pickerOffen = true"
            >
              Material zuordnen
            </UiButton>
          </UiLeerzustand>

          <UiLeerzustand
            v-else-if="!gruppen.length"
            klein
            icon="magnifying-glass"
            titel="Keine Treffer"
            text="Passe die Eingrenzung an."
          />

          <section v-for="gruppe in gruppen" :key="gruppe.id" class="space-y-2">
            <h2 class="flex items-center gap-2 text-sm font-semibold text-ink">
              <UiIcon :name="gruppe.icon" fest class="text-primary" />
              {{ gruppe.label }}
              <span class="font-normal text-ink-subtle">{{ gruppe.eintraege.length }}</span>
            </h2>
            <div class="space-y-2">
              <div
                v-for="item in gruppe.eintraege"
                :key="item.id"
                class="flex items-stretch gap-2"
              >
                <MaterialKarte
                  class="min-w-0 flex-1"
                  :material="item"
                  @favorit="favoritSetzen"
                />
                <UiButton
                  v-if="darfBearbeiten"
                  class="self-center"
                  variante="still"
                  groesse="sm"
                  icon="xmark"
                  nur-icon
                  title="Vom Lehrwerk lösen"
                  @click="zuordnungLoesen(item.relationId)"
                />
              </div>
            </div>
          </section>
        </div>
      </div>
    </template>

    <MaterialAuswahlModal
      v-model="pickerOffen"
      titel="Material diesem Lehrwerk zuordnen"
      :ausschliessen="bereitsZugeordnet"
      :exclude-material-types="['lehrwerk']"
      @ausgewaehlt="materialZuordnen"
    />

    <MaterialVorschauModal
      v-model="vorschauOffen"
      :asset-id="vorschauAssetId"
      :titel="vorschauTitel"
      @herunterladen="assetHerunterladen"
    />

    <UiConfirm
      v-model="loeschenOffen"
      gefahr
      titel="Lehrwerk löschen?"
      text="Das Lehrwerk und die Buchdatei werden unwiderruflich entfernt. Zugeordnete Materialien (Lösungsheft, Arbeitsblätter …) bleiben erhalten, nur die Zuordnung entfällt."
      bestaetigen="Ja, ich will löschen"
      @bestaetigt="lehrwerkLoeschen"
    />
  </div>
</template>
