<script setup lang="ts">
import { materialTypes, importStatuses } from '#shared/utils/labels'
import {
  jahrgangsstufenOptionen,
  type GradeLevel,
} from '#shared/utils/jahrgangsstufen'

useHead({ title: 'Stapel-Upload' })

const { darfBearbeiten } = useSitzung()
if (!darfBearbeiten.value) await navigateTo('/materialien')

const { aufruf, laeuft } = useApi()
const { fachOptionen } = useTaxonomie()
const { optionen: schulformOptionen } = useSchulformen()

const jahrgangOptionen = jahrgangsstufenOptionen()

interface BulkLauf {
  id: string
  sourceFileName: string
  sourceSizeBytes: number | null
  status: string
  stats: Record<string, unknown> | null
  errorMessage: string | null
  startedAt: string
  finishedAt: string | null
  undoneAt: string | null
}

const { data: laeufe, refresh } = await useFetch<BulkLauf[]>('/api/materials/bulk', {
  default: () => [],
})

const dateien = ref<File[]>([])
const ziehe = ref(false)
const dateiInput = ref<HTMLInputElement | null>(null)
const fehler = ref<string | null>(null)

const mapping = reactive({
  subjectId: null as string | null,
  subjectName: '',
  gradeLevel: null as GradeLevel | null,
  schoolForm: null as string | null,
  defaultMaterialType: 'arbeitsblatt' as string,
  linkDuplicates: true,
})

function dateienHinzufuegen(files: FileList | null | undefined) {
  if (!files?.length) return
  const bestehende = new Set(dateien.value.map((f) => `${f.name}:${f.size}:${f.lastModified}`))
  for (const file of Array.from(files)) {
    if (!/\.pdf$/i.test(file.name)) continue
    const schluessel = `${file.name}:${file.size}:${file.lastModified}`
    if (!bestehende.has(schluessel)) {
      dateien.value.push(file)
      bestehende.add(schluessel)
    }
  }
  if (dateiInput.value) dateiInput.value.value = ''
  fehler.value = null
}

function dateiEntfernen(index: number) {
  dateien.value.splice(index, 1)
}

async function analysieren() {
  if (!dateien.value.length) return
  fehler.value = null

  const body = new FormData()
  for (const file of dateien.value) body.append('files', file)
  body.append(
    'mapping',
    JSON.stringify({
      subjectId: mapping.subjectId,
      subjectName: mapping.subjectName || undefined,
      gradeLevel: mapping.gradeLevel,
      schoolForm: mapping.schoolForm,
      defaultMaterialType: mapping.defaultMaterialType,
      linkDuplicates: mapping.linkDuplicates,
    }),
  )

  try {
    const ergebnis = await aufruf<{ runId: string }>('/api/materials/bulk/analyze', {
      method: 'POST',
      body,
      erfolgsmeldung: 'Dateien analysiert.',
      stumm: true,
    })
    if (ergebnis) await navigateTo(`/materialien/stapel/${ergebnis.runId}`)
  } catch (error) {
    fehler.value = (error as { nachricht?: string }).nachricht ?? toApiFehler(error).nachricht
  }
}
</script>

<template>
  <div>
    <LayoutSeitenkopf
      zurueck-to="/materialien"
      zurueck-label="Alle Materialien"
      kicker="Materialien"
      titel="Stapel-Upload"
      untertitel="Mehrere PDFs hochladen, gemeinsame Einordnung setzen, KI-Vorschläge prüfen und einmal anlegen."
    />

    <UiCard titel="PDFs hochladen" icon="cloud-arrow-up" class="mb-6">
      <div
        class="rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors"
        :class="ziehe ? 'border-primary bg-primary-soft/40' : 'border-line bg-surface-sunken/40'"
        @dragover.prevent="ziehe = true"
        @dragleave.prevent="ziehe = false"
        @drop.prevent="ziehe = false; dateienHinzufuegen(($event as DragEvent).dataTransfer?.files)"
      >
        <UiIcon name="file-pdf" class="mb-3 text-3xl text-primary" />
        <p class="font-medium text-ink">PDFs hier ablegen</p>
        <p class="mt-1 text-sm text-ink-muted">
          Mehrere Dateien möglich – Analyse mit Metadaten-Vorschlägen, kein stiller Auto-Import
        </p>
        <label class="mt-4 inline-flex cursor-pointer">
          <input
            ref="dateiInput"
            type="file"
            accept=".pdf,application/pdf"
            multiple
            class="sr-only"
            @change="dateienHinzufuegen(($event.target as HTMLInputElement).files)"
          >
          <span class="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-hover">
            <UiIcon name="folder-open" fest /> Dateien wählen
          </span>
        </label>
      </div>

      <ul v-if="dateien.length" class="mt-4 space-y-1.5">
        <li
          v-for="(datei, index) in dateien"
          :key="`${datei.name}-${datei.size}-${datei.lastModified}`"
          class="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        >
          <UiIcon name="file-pdf" fest class="text-ink-subtle" />
          <span class="min-w-0 flex-1 truncate font-medium text-ink">{{ datei.name }}</span>
          <span class="text-xs text-ink-subtle">{{ formatBytes(datei.size) }}</span>
          <UiButton
            type="button"
            variante="still"
            groesse="sm"
            icon="xmark"
            nur-icon
            title="Datei entfernen"
            @click="dateiEntfernen(index)"
          />
        </li>
      </ul>
    </UiCard>

    <UiCard titel="Gemeinsame Zuordnung" icon="sliders" class="mb-6" einklappbar einklapp-id="stapel-zuordnung">
      <p class="mb-4 text-sm text-ink-muted">
        Diese Angaben gelten für alle Dateien im Stapel. Titel, Typ und Schlagwörter kannst du danach je Datei prüfen.
      </p>
      <div class="grid gap-4 sm:grid-cols-2">
        <UiField label="Fach (bestehend)">
          <UiSelect v-model="mapping.subjectId" platzhalter="Neu anlegen …" :optionen="fachOptionen" />
        </UiField>
        <UiField label="Fachname (neu)">
          <UiInput v-model="mapping.subjectName" :disabled="Boolean(mapping.subjectId)" />
        </UiField>
        <UiField label="Jahrgang">
          <UiSelect
            v-model="mapping.gradeLevel"
            platzhalter="Keiner"
            :optionen="jahrgangOptionen.map((o) => ({ value: o.value, label: o.label }))"
          />
        </UiField>
        <UiField label="Schulform">
          <UiSelect
            v-model="mapping.schoolForm"
            platzhalter="Optional"
            :optionen="schulformOptionen.map((o) => ({ value: o.value, label: o.label }))"
          />
        </UiField>
        <UiField label="Standard-Materialart" class="sm:col-span-2">
          <UiSelect
            v-model="mapping.defaultMaterialType"
            :optionen="materialTypes.options().map((o) => ({ value: o.value, label: o.label }))"
          />
        </UiField>
      </div>
      <label class="mt-4 flex items-center gap-2 text-sm">
        <input v-model="mapping.linkDuplicates" type="checkbox" class="accent-[var(--color-primary)]">
        Erkannte Dubletten standardmäßig abwählen
      </label>
    </UiCard>

    <p v-if="fehler" class="mb-4 text-sm text-danger" role="alert">{{ fehler }}</p>

    <div class="mb-10 flex justify-end">
      <UiButton
        variante="primaer"
        icon="magnifying-glass"
        :laedt="laeuft"
        :disabled="!dateien.length"
        @click="analysieren"
      >
        Analysieren &amp; Vorschläge holen
      </UiButton>
    </div>

    <section>
      <h2 class="mb-3 text-lg text-ink">Letzte Stapel</h2>
      <UiLeerzustand
        v-if="!laeufe?.length"
        klein
        icon="layer-group"
        titel="Noch keine Stapel-Uploads"
        text="Abgeschlossene und offene Stapel erscheinen hier."
      />
      <ul v-else class="space-y-2">
        <li v-for="lauf in laeufe" :key="lauf.id">
          <NuxtLink
            :to="`/materialien/stapel/${lauf.id}`"
            class="karte karte-klickbar flex flex-wrap items-center gap-3 p-4"
          >
            <span class="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary-strong">
              <UiIcon name="layer-group" fest />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium text-ink">{{ lauf.sourceFileName }}</span>
              <span class="text-xs text-ink-subtle">
                {{ formatDatumZeit(lauf.startedAt) }}
                <template v-if="lauf.sourceSizeBytes">
                  · {{ formatBytes(lauf.sourceSizeBytes) }}
                </template>
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
      <button
        v-if="laeufe?.length"
        type="button"
        class="mt-3 text-xs text-ink-subtle hover:text-primary"
        @click="refresh()"
      >
        Liste aktualisieren
      </button>
    </section>
  </div>
</template>
