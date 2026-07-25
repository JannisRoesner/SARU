<script setup lang="ts">
import { materialTypes } from '#shared/utils/labels'
import type { GradeLevel } from '#shared/utils/jahrgangsstufen'
import type { MaterialDetail } from '~~/server/repositories/material.repository'

definePageMeta({ middleware: [] })
useHead({ title: 'Material anlegen' })

const { darfBearbeiten } = useSitzung()
const { aufruf, laeuft } = useApi()
const { fachOptionen, schlagwortNamen } = useTaxonomie()
const { optionen: schulformOptionen } = useSchulformen()

if (!darfBearbeiten.value) {
  await navigateTo('/materialien')
}

const formular = reactive({
  title: '',
  description: '',
  materialType: 'arbeitsblatt' as string,
  schoolForm: null as string | null,
  subjectIds: [] as string[],
  topicIds: [] as string[],
  learningGroupIds: [] as string[],
  gradeLevels: [] as GradeLevel[],
  tagNames: [] as string[],
  learningObjectives: [] as string[],
  source: '',
  author: '',
})

const dateien = ref<File[]>([])
const ziehe = ref(false)
const dateiInput = ref<HTMLInputElement | null>(null)

function dateienHinzufuegen(files: FileList | null | undefined) {
  if (!files?.length) return
  const bestehende = new Set(dateien.value.map((f) => `${f.name}:${f.size}:${f.lastModified}`))
  for (const file of Array.from(files)) {
    const schluessel = `${file.name}:${file.size}:${file.lastModified}`
    if (!bestehende.has(schluessel)) {
      dateien.value.push(file)
      bestehende.add(schluessel)
    }
  }
  if (dateiInput.value) dateiInput.value.value = ''
}

function dateiEntfernen(index: number) {
  dateien.value.splice(index, 1)
}

async function anlegen() {
  const mitDateien = dateien.value.length > 0
  const ergebnis = await aufruf<MaterialDetail>('/api/materials', {
    method: 'POST',
    body: {
      ...formular,
      description: formular.description || null,
      schoolForm: formular.schoolForm || null,
      source: formular.source || null,
      author: formular.author || null,
    },
    erfolgsmeldung: mitDateien ? undefined : 'Material angelegt.',
  })
  if (!ergebnis) return

  if (mitDateien) {
    const variante = ergebnis.variants.find((v) => v.isDefault) ?? ergebnis.variants[0]
    if (variante) {
      const body = new FormData()
      for (const file of dateien.value) body.append('files', file)
      body.append('role', 'anhang')
      await aufruf(`/api/variants/${variante.id}/uploads`, {
        method: 'POST',
        body,
        erfolgsmeldung: 'Material angelegt und Dateien hochgeladen.',
      })
    }
  }

  await navigateTo(`/materialien/${ergebnis.id}`)
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <LayoutSeitenkopf
      kicker="Neu"
      titel="Material anlegen"
      untertitel="Titel und Typ genügen zum Start. Dateien kannst du direkt hier anhängen."
    >
      <template #aktionen>
        <UiButton to="/materialien/stapel" variante="sekundaer" icon="layer-group">
          Stapel-Upload
        </UiButton>
        <UiButton to="/materialien" variante="still" icon="arrow-left">Zurück</UiButton>
      </template>
    </LayoutSeitenkopf>

    <form class="space-y-5" @submit.prevent="anlegen">
      <UiCard titel="Grundangaben" icon="file-lines" einklappbar einklapp-id="material-neu-grundangaben">
        <div class="space-y-4">
          <UiField label="Titel" pflicht>
            <UiInput v-model="formular.title" placeholder="z. B. AB 1 – Photosynthese" />
          </UiField>
          <UiEinklappbaresFeld
            v-model="formular.description"
            label="Kurzbeschreibung"
            einklapp-id="material-neu-beschreibung"
            leer-vorschau="Keine Beschreibung"
            placeholder="Worum geht es?"
            immer-offen
          />
          <div class="grid gap-4 sm:grid-cols-2">
            <UiField label="Materialart" pflicht>
              <UiSelect
                v-model="formular.materialType"
                :optionen="materialTypes.options().map((o) => ({ value: o.value, label: o.label }))"
              />
            </UiField>
            <UiField label="Schulform">
              <UiSelect
                v-model="formular.schoolForm"
                platzhalter="Optional"
                :optionen="schulformOptionen.map((o) => ({ value: o.value, label: o.label }))"
              />
            </UiField>
          </div>
        </div>
      </UiCard>

      <UiCard
        titel="Dateien"
        untertitel="Optional – Anhänge werden nach dem Anlegen zur Standardfassung hochgeladen."
        icon="cloud-arrow-up"
      >
        <div
          class="rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors"
          :class="ziehe ? 'border-primary bg-primary-soft/40' : 'border-line bg-surface-sunken/40'"
          @dragover.prevent="ziehe = true"
          @dragleave.prevent="ziehe = false"
          @drop.prevent="ziehe = false; dateienHinzufuegen(($event as DragEvent).dataTransfer?.files)"
        >
          <UiIcon name="cloud-arrow-up" class="mb-3 text-3xl text-primary" />
          <p class="font-medium text-ink">Dateien hier ablegen</p>
          <p class="mt-1 text-sm text-ink-muted">
            z. B. PDF, Bilder oder Office-Dokumente – mehrere Dateien möglich
          </p>
          <label class="mt-4 inline-flex cursor-pointer">
            <input
              ref="dateiInput"
              type="file"
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
            <UiIcon name="paperclip" fest class="text-ink-subtle" />
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

      <UiCard titel="Einordnung" icon="sitemap" einklappbar einklapp-id="material-neu-einordnung">
        <div class="space-y-4">
          <UiField label="Fächer">
            <select
              multiple
              class="min-h-28 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              :value="formular.subjectIds"
              @change="formular.subjectIds = Array.from(($event.target as HTMLSelectElement).selectedOptions).map((o) => o.value)"
            >
              <option v-for="fach in fachOptionen" :key="fach.value" :value="fach.value">
                {{ fach.label }}
              </option>
            </select>
          </UiField>
          <UiField label="Jahrgangsstufen">
            <UiJahrgangsstufenAuswahl v-model="formular.gradeLevels" />
          </UiField>
          <UiField label="Schlagwörter">
            <UiTagInput v-model="formular.tagNames" :vorschlaege="schlagwortNamen" />
          </UiField>
          <UiField label="Lernziele">
            <UiTagInput
              v-model="formular.learningObjectives"
              platzhalter="Lernziel hinzufügen …"
            />
          </UiField>
        </div>
      </UiCard>

      <div class="flex justify-end gap-2">
        <UiButton to="/materialien" variante="sekundaer">Abbrechen</UiButton>
        <UiButton
          type="submit"
          variante="primaer"
          icon="check"
          :laedt="laeuft"
          :disabled="!formular.title.trim()"
        >
          {{ dateien.length ? 'Anlegen & hochladen' : 'Anlegen' }}
        </UiButton>
      </div>
    </form>
  </div>
</template>
