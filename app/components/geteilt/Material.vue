<script setup lang="ts">
import { materialTypes } from '#shared/utils/labels'
import type { GastMaterial } from '~~/server/services/share-view.service'

/** Ansicht eines Materials über einen Freigabe-Link – mit Bearbeitung, wenn der Link es erlaubt. */
const props = defineProps<{
  token: string
  material: GastMaterial
  recht: 'ansehen' | 'bearbeiten'
}>()

const emit = defineEmits<{ geaendert: [] }>()

const { aufruf, laeuft } = useApi()
const basis = computed(() => `/api/geteilt/${props.token}/dateien`)
const darfBearbeiten = computed(() => props.recht === 'bearbeiten')

const vorschauId = ref<string | null>(null)
const vorschauOffen = computed({
  get: () => vorschauId.value !== null,
  set: (wert) => {
    if (!wert) vorschauId.value = null
  },
})

const formular = reactive({ title: '', description: '' })
watch(
  () => props.material,
  (m) => {
    formular.title = m.title
    formular.description = m.description ?? ''
  },
  { immediate: true },
)
const geaendert = computed(
  () => formular.title.trim() !== props.material.title || (formular.description || '') !== (props.material.description ?? ''),
)

async function speichern() {
  const ok = await aufruf(`/api/geteilt/${props.token}/materialien/${props.material.id}`, {
    method: 'PATCH',
    body: { title: formular.title.trim(), description: formular.description.trim() || null },
    erfolgsmeldung: 'Gespeichert.',
  })
  if (ok) emit('geaendert')
}

const dateiInput = ref<HTMLInputElement | null>(null)
async function hochladen(files: FileList | null) {
  if (!files?.length) return
  const body = new FormData()
  for (const f of Array.from(files)) body.append('files', f, f.name)
  const ok = await aufruf(`/api/geteilt/${props.token}/materialien/${props.material.id}/dateien`, {
    method: 'POST',
    body,
    erfolgsmeldung: 'Datei hinzugefügt.',
  })
  if (dateiInput.value) dateiInput.value.value = ''
  if (ok) emit('geaendert')
}

function herunterladen(assetId: string) {
  window.open(`${basis.value}/${assetId}/download`, '_blank')
}
</script>

<template>
  <div class="space-y-5">
    <div>
      <p class="text-xs font-semibold tracking-wider text-ink-subtle uppercase">
        {{ materialTypes.label(material.materialType as never) }}
      </p>
      <template v-if="darfBearbeiten">
        <form class="mt-2 space-y-3" @submit.prevent="speichern">
          <UiField label="Titel">
            <UiInput v-model="formular.title" />
          </UiField>
          <UiField label="Beschreibung">
            <UiTextarea v-model="formular.description" :zeilen="3" />
          </UiField>
          <div class="flex justify-end">
            <UiButton type="submit" variante="primaer" icon="floppy-disk" :disabled="!geaendert" :laedt="laeuft">
              Speichern
            </UiButton>
          </div>
        </form>
      </template>
      <template v-else>
        <h1 class="mt-1 text-2xl font-semibold text-ink">{{ material.title }}</h1>
        <p v-if="material.description" class="mt-2 whitespace-pre-line text-ink-muted">{{ material.description }}</p>
      </template>
      <div v-if="material.subjects.length || material.gradeLevels.length" class="mt-3 flex flex-wrap gap-1.5">
        <UiBadge v-for="fach in material.subjects" :key="fach">{{ fach }}</UiBadge>
        <UiBadge v-if="material.gradeLevels.length">{{ formatJahrgaenge(material.gradeLevels as never) }}</UiBadge>
        <UiBadge v-if="material.source" icon="quote-left">{{ material.source }}</UiBadge>
      </div>
    </div>

    <UiCard
      v-for="fassung in material.fassungen.filter((f) => f.dateien.length || darfBearbeiten)"
      :key="fassung.id"
      :titel="material.fassungen.length > 1 ? fassung.label : 'Dateien'"
      icon="file-lines"
    >
      <p v-if="!fassung.dateien.length" class="text-sm text-ink-subtle">Keine Dateien.</p>
      <ul v-else class="divide-y divide-line">
        <li v-for="datei in fassung.dateien" :key="datei.id" class="flex flex-wrap items-center gap-3 py-2.5">
          <MaterialVorschauMiniatur
            v-if="datei.kind === 'datei'"
            :asset-id="datei.id"
            :file-name="datei.fileName"
            :mime-type="datei.mimeType"
            :api-basis="basis"
            groesse="sm"
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium text-ink">{{ datei.title || datei.fileName || datei.url }}</span>
            <span v-if="datei.sizeBytes" class="text-xs text-ink-subtle">{{ formatBytes(datei.sizeBytes) }}</span>
          </span>
          <template v-if="datei.kind === 'datei'">
            <UiButton variante="sekundaer" groesse="sm" icon="eye" @click="vorschauId = datei.id">Ansehen</UiButton>
            <UiButton variante="sekundaer" groesse="sm" icon="download" @click="herunterladen(datei.id)">
              Herunterladen
            </UiButton>
          </template>
          <UiButton v-else-if="datei.url" :to="datei.url" variante="sekundaer" groesse="sm" icon="arrow-up-right-from-square">
            Öffnen
          </UiButton>
        </li>
      </ul>
    </UiCard>

    <div v-if="darfBearbeiten">
      <input ref="dateiInput" type="file" multiple class="sr-only" @change="hochladen(($event.target as HTMLInputElement).files)">
      <UiButton variante="sekundaer" icon="cloud-arrow-up" :laedt="laeuft" @click="dateiInput?.click()">
        Datei hinzufügen
      </UiButton>
    </div>

    <UiCard v-if="material.anhaengend.length" titel="Dazu gehört" icon="link">
      <ul class="space-y-1">
        <li v-for="teil in material.anhaengend" :key="teil.id">
          <NuxtLink :to="`/geteilt/${token}/material/${teil.id}`" class="font-medium text-primary hover:underline">
            {{ teil.title }}
          </NuxtLink>
          <span class="ml-2 text-xs text-ink-subtle">{{ materialTypes.label(teil.materialType as never) }}</span>
        </li>
      </ul>
    </UiCard>

    <MaterialVorschauModal
      v-model="vorschauOffen"
      :asset-id="vorschauId"
      :api-basis="basis"
      @herunterladen="herunterladen"
    />
  </div>
</template>
