<script setup lang="ts">
import { importStatuses } from '#shared/utils/labels'

useHead({ title: 'Import' })

const { darfBearbeiten } = useSitzung()
if (!darfBearbeiten.value) await navigateTo('/')

const { aufruf, laeuft } = useApi()

interface ImportLauf {
  id: string
  sourceFileName: string
  sourceSizeBytes: number
  adapterId: string
  status: string
  stats: Record<string, unknown> | null
  errorMessage: string | null
  startedAt: string
  finishedAt: string | null
  undoneAt: string | null
}

interface AnalyseErgebnis {
  runId: string
  adapterLabel: string
  confidence: number
}

const { data: laeufe, refresh } = await useFetch<ImportLauf[]>('/api/imports', {
  default: () => [],
})

const datei = ref<File | null>(null)
const ziehe = ref(false)
const fehler = ref<string | null>(null)

function dateiSetzen(files: FileList | null | undefined) {
  const f = files?.[0]
  if (!f) return
  datei.value = f
  fehler.value = null
}

async function analysieren() {
  if (!datei.value) return
  fehler.value = null
  const body = new FormData()
  body.append('file', datei.value)
  try {
    const ergebnis = await aufruf<AnalyseErgebnis>('/api/imports/analyze', {
      method: 'POST',
      body,
      erfolgsmeldung: 'Export analysiert.',
      stumm: true,
    })
    if (ergebnis) await navigateTo(`/import/${ergebnis.runId}`)
  } catch (error) {
    fehler.value = (error as { nachricht?: string }).nachricht ?? toApiFehler(error).nachricht
  }
}
</script>

<template>
  <div>
    <LayoutSeitenkopf
      kicker="Werkzeuge"
      titel="Import"
      untertitel="Kursmappen aus dem Schulportal importieren."
    />

    <UiCard titel="Neue Datei hochladen" icon="file-import" class="mb-8" einklappbar einklapp-id="import-upload">
      <div
        class="rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors"
        :class="ziehe ? 'border-primary bg-primary-soft/40' : 'border-line bg-surface-sunken/40'"
        @dragover.prevent="ziehe = true"
        @dragleave.prevent="ziehe = false"
        @drop.prevent="ziehe = false; dateiSetzen(($event as DragEvent).dataTransfer?.files)"
      >
        <UiIcon name="cloud-arrow-up" class="mb-3 text-3xl text-primary" />
        <p class="font-medium text-ink">ZIP-Export hier ablegen</p>
        <p class="mt-1 text-sm text-ink-muted">
          z. B. Schulportal-Kursmappe mit Stunden und Anhängen
        </p>
        <label class="mt-4 inline-flex cursor-pointer">
          <input
            type="file"
            accept=".zip,application/zip"
            class="sr-only"
            @change="dateiSetzen(($event.target as HTMLInputElement).files)"
          >
          <span class="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-hover">
            <UiIcon name="folder-open" fest /> Datei wählen
          </span>
        </label>
        <p v-if="datei" class="mt-4 text-sm text-ink">
          <UiIcon name="file-zipper" class="mr-1" />
          {{ datei.name }}
          <span class="text-ink-subtle"> ({{ formatBytes(datei.size) }})</span>
        </p>
      </div>

      <p v-if="fehler" class="mt-3 text-sm text-danger" role="alert">{{ fehler }}</p>

      <div class="mt-4 flex justify-end">
        <UiButton
          variante="primaer"
          icon="magnifying-glass"
          :laedt="laeuft"
          :disabled="!datei"
          @click="analysieren"
        >
          Analysieren
        </UiButton>
      </div>
    </UiCard>

    <section>
      <h2 class="mb-3 text-lg text-ink">Letzte Importe</h2>
      <UiLeerzustand
        v-if="!laeufe?.length"
        klein
        icon="clock-rotate-left"
        titel="Noch keine Importe"
        text="Hochgeladene Exporte erscheinen hier mit Status und Verlauf."
      />
      <ul v-else class="space-y-2">
        <li v-for="lauf in laeufe" :key="lauf.id">
          <NuxtLink
            :to="`/import/${lauf.id}`"
            class="karte karte-klickbar flex flex-wrap items-center gap-3 p-4"
          >
            <span class="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary-strong">
              <UiIcon name="file-zipper" fest />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium text-ink">{{ lauf.sourceFileName }}</span>
              <span class="text-xs text-ink-subtle">
                {{ formatDatumZeit(lauf.startedAt) }}
                · {{ formatBytes(lauf.sourceSizeBytes) }}
              </span>
            </span>
            <UiBadge
              :ton="importStatuses.tone(lauf.status as never)"
              :icon="importStatuses.icon(lauf.status as never)"
            >
              {{ importStatuses.label(lauf.status as never) }}
            </UiBadge>
          </NuxtLink>
        </li>
      </ul>
    </section>
  </div>
</template>
