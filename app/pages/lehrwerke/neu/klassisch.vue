<script setup lang="ts">
import type { GradeLevel } from '#shared/utils/jahrgangsstufen'
import { materialPfad } from '#shared/utils/material-pfad'
import type { MaterialDetail } from '~~/server/repositories/material.repository'

definePageMeta({ middleware: [] })
useHead({ title: 'Lehrwerk klassisch anlegen' })

const { darfBearbeiten } = useSitzung()
const { aufruf, laeuft } = useApi()
const { schlagwortNamen } = useTaxonomie()

if (!darfBearbeiten.value) {
  await navigateTo('/lehrwerke')
}

const formular = reactive({
  title: '',
  description: '',
  source: '',
  author: '',
  subjectNames: [] as string[],
  gradeLevels: [] as GradeLevel[],
  tagNames: [] as string[],
})

const dateien = ref<File[]>([])
const ziehe = ref(false)
const dateiInput = ref<HTMLInputElement | null>(null)

function dateienHinzufuegen(files: FileList | null | undefined) {
  const file = files?.[0]
  if (!file) return
  dateien.value = [file]
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
      title: formular.title,
      description: formular.description || null,
      materialType: 'lehrwerk',
      source: formular.source || null,
      author: formular.author || null,
      subjectNames: formular.subjectNames,
      gradeLevels: formular.gradeLevels,
      tagNames: formular.tagNames,
    },
    erfolgsmeldung: mitDateien ? undefined : 'Lehrwerk angelegt.',
  })
  if (!ergebnis) return

  if (mitDateien) {
    const variante = ergebnis.variants.find((v) => v.isDefault) ?? ergebnis.variants[0]
    if (variante) {
      const body = new FormData()
      for (const file of dateien.value) body.append('files', file)
      body.append('role', 'haupt')
      await aufruf(`/api/variants/${variante.id}/uploads`, {
        method: 'POST',
        body,
        erfolgsmeldung: 'Lehrwerk angelegt und Buchdatei hochgeladen.',
      })
    }
  }

  await navigateTo(materialPfad(ergebnis))
}
</script>

<template>
  <div>
    <LayoutSeitenkopf
      zurueck-to="/lehrwerke/neu"
      zurueck-label="Wege zum Anlegen"
      kicker="Lehrwerke"
      titel="Klassisch anlegen"
      untertitel="Angaben und Buchdatei"
    />

    <form class="space-y-5" @submit.prevent="anlegen">
      <UiCard titel="Angaben" icon="book">
        <div class="space-y-4">
          <UiField label="Titel" pflicht>
            <UiInput v-model="formular.title" placeholder="z. B. Klett Biologie Oberstufe" />
          </UiField>
          <UiEinklappbaresFeld
            v-model="formular.description"
            label="Kurzbeschreibung"
            einklapp-id="lehrwerk-neu-beschreibung"
            leer-vorschau="Keine Beschreibung"
            placeholder="Ausgabe, Band, Verlag …"
            immer-offen
          />
          <div class="grid gap-4 sm:grid-cols-2">
            <UiField label="Verlag / Quelle">
              <UiInput v-model="formular.source" placeholder="z. B. Klett" />
            </UiField>
            <UiField label="Autor">
              <UiInput v-model="formular.author" />
            </UiField>
          </div>
          <UiField label="Fächer">
            <MaterialFachAuswahl v-model="formular.subjectNames" />
          </UiField>
          <UiField label="Jahrgangsstufen">
            <UiJahrgangsstufenAuswahl v-model="formular.gradeLevels" />
          </UiField>
          <UiField label="Schlagwörter">
            <UiTagInput v-model="formular.tagNames" :vorschlaege="schlagwortNamen" />
          </UiField>
        </div>
      </UiCard>

      <UiCard
        titel="Buchdatei"
        untertitel="PDF des Schülerbuchs"
        icon="book"
      >
        <div
          class="rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors"
          :class="ziehe ? 'border-primary bg-primary-soft/40' : 'border-line bg-surface-sunken/40'"
          @dragover.prevent="ziehe = true"
          @dragleave.prevent="ziehe = false"
          @drop.prevent="ziehe = false; dateienHinzufuegen(($event as DragEvent).dataTransfer?.files)"
        >
          <UiIcon name="cloud-arrow-up" class="mb-3 text-3xl text-primary" />
          <p class="font-medium text-ink">Buch-PDF hier ablegen</p>
          <p class="mt-1 text-sm text-ink-muted">Eine Datei – meist die PDF des Schülerbuchs</p>
          <label class="mt-4 inline-flex cursor-pointer">
            <input
              ref="dateiInput"
              type="file"
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

      <div class="flex justify-end gap-2">
        <UiButton to="/lehrwerke/neu" variante="sekundaer">Abbrechen</UiButton>
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
