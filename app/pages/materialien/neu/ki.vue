<script setup lang="ts">
import { materialTypes } from '#shared/utils/labels'
import type { GradeLevel } from '#shared/utils/jahrgangsstufen'
import type { MaterialDetail } from '~~/server/repositories/material.repository'
import type { MaterialType } from '#shared/types/domain'

definePageMeta({ middleware: [] })
useHead({ title: 'Material mit KI anlegen' })

const { darfBearbeiten } = useSitzung()
const { aufruf, laeuft } = useApi()
const { fachOptionen, schlagwortNamen } = useTaxonomie()
const { optionen: schulformOptionen } = useSchulformen()

if (!darfBearbeiten.value) {
  await navigateTo('/materialien')
}

interface AnalyseErgebnis {
  analyzeId: string
  fileName: string
  sizeBytes: number
  hasText: boolean
  extractionMethod: 'text_layer' | 'vision' | 'none'
  textPreview: string | null
  pageCount: number | null
  aiEnabled: boolean
  suggestions: {
    title: string
    materialType: MaterialType
    schoolForm: string | null
    tagNames: string[]
    learningObjectives: string[]
    description: string
    contentSummary: string
    aiUsed: boolean
  }
  warnings: string[]
}

const analyse = ref<AnalyseErgebnis | null>(null)
const fehler = ref<string | null>(null)
const ziehe = ref(false)
const dateiInput = ref<HTMLInputElement | null>(null)

const formular = reactive({
  title: '',
  description: '',
  content: '',
  materialType: 'arbeitsblatt' as MaterialType,
  schoolForm: null as string | null,
  subjectIds: [] as string[],
  gradeLevels: [] as GradeLevel[],
  tagNames: [] as string[],
  learningObjectives: [] as string[],
})

const ACCEPT =
  '.pdf,.docx,.pptx,.xlsx,.odt,.odp,.ods,.txt,.md,.csv,application/pdf'

async function dateiAnalysieren(files: FileList | null | undefined) {
  fehler.value = null
  const file = files?.[0]
  if (!file) return

  if (analyse.value?.analyzeId) {
    await $fetch(`/api/materials/ai/${analyse.value.analyzeId}`, {
      method: 'DELETE',
    }).catch(() => {})
  }

  const body = new FormData()
  body.append('file', file)

  try {
    const ergebnis = await $fetch<AnalyseErgebnis>('/api/materials/ai/analyze', {
      method: 'POST',
      body,
    })
    analyse.value = ergebnis
    formular.title = ergebnis.suggestions.title
    formular.description = ergebnis.suggestions.description
    formular.content = ergebnis.suggestions.contentSummary
    formular.materialType = ergebnis.suggestions.materialType
    formular.schoolForm = ergebnis.suggestions.schoolForm
    formular.tagNames = [...ergebnis.suggestions.tagNames]
    formular.learningObjectives = [...ergebnis.suggestions.learningObjectives]
  } catch (error) {
    analyse.value = null
    fehler.value = toApiFehler(error).nachricht
  }

  if (dateiInput.value) dateiInput.value.value = ''
}

async function anlegen() {
  if (!analyse.value) {
    fehler.value = 'Bitte zuerst eine Datei hochladen und analysieren.'
    return
  }

  const ergebnis = await aufruf<MaterialDetail>(
    `/api/materials/ai/${analyse.value.analyzeId}/commit`,
    {
      method: 'POST',
      body: {
        title: formular.title.trim(),
        description: formular.description || null,
        content: formular.content || null,
        materialType: formular.materialType,
        schoolForm: formular.schoolForm || null,
        subjectIds: formular.subjectIds,
        gradeLevels: formular.gradeLevels,
        tagNames: formular.tagNames,
        learningObjectives: formular.learningObjectives,
      },
      erfolgsmeldung: 'Material mit KI-Vorschlägen angelegt.',
    },
  )
  if (!ergebnis) return
  analyse.value = null
  await navigateTo(`/materialien/${ergebnis.id}`)
}

async function zuruecksetzen() {
  if (analyse.value?.analyzeId) {
    await $fetch(`/api/materials/ai/${analyse.value.analyzeId}`, {
      method: 'DELETE',
    }).catch(() => {})
  }
  analyse.value = null
  fehler.value = null
  formular.title = ''
  formular.description = ''
  formular.content = ''
  formular.materialType = 'arbeitsblatt'
  formular.schoolForm = null
  formular.subjectIds = []
  formular.gradeLevels = []
  formular.tagNames = []
  formular.learningObjectives = []
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <LayoutSeitenkopf
      zurueck-to="/materialien/neu"
      zurueck-label="Wege zum Anlegen"
      kicker="Materialien"
      titel="Mit KI anlegen"
      untertitel="Datei hochladen – Vorschläge prüfen und nach Bedarf anpassen. Scans werden per Vision/OCR lesbar."
    />

    <form class="space-y-5" @submit.prevent="anlegen">
      <UiCard titel="Dokument" icon="wand-magic-sparkles">
        <div
          v-if="!analyse"
          class="rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors"
          :class="ziehe ? 'border-primary bg-primary-soft/40' : 'border-line bg-surface-sunken/40'"
          @dragover.prevent="ziehe = true"
          @dragleave.prevent="ziehe = false"
          @drop.prevent="ziehe = false; dateiAnalysieren(($event as DragEvent).dataTransfer?.files)"
        >
          <UiIcon name="cloud-arrow-up" class="mb-3 text-3xl text-primary" />
          <p class="font-medium text-ink">Datei hier ablegen</p>
          <p class="mt-1 text-sm text-ink-muted">
            PDF, Word, PowerPoint, Tabellen oder Text – Moodle-Archive bitte separat
          </p>
          <label class="mt-4 inline-flex cursor-pointer">
            <input
              ref="dateiInput"
              type="file"
              :accept="ACCEPT"
              class="sr-only"
              @change="dateiAnalysieren(($event.target as HTMLInputElement).files)"
            >
            <span class="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-hover">
              <UiIcon name="folder-open" fest /> Datei wählen
            </span>
          </label>
        </div>

        <div v-else class="space-y-3">
          <div class="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-sunken/40 px-3 py-2 text-sm">
            <UiIcon name="paperclip" fest class="text-ink-subtle" />
            <span class="min-w-0 flex-1 truncate font-medium text-ink">{{ analyse.fileName }}</span>
            <span class="text-xs text-ink-subtle">{{ formatBytes(analyse.sizeBytes) }}</span>
            <span
              class="rounded-md px-2 py-0.5 text-xs font-medium"
              :class="analyse.suggestions.aiUsed ? 'bg-primary-soft text-primary' : 'bg-surface text-ink-muted'"
            >
              {{ analyse.suggestions.aiUsed ? 'KI-Vorschläge' : 'ohne KI' }}
            </span>
            <span
              v-if="analyse.extractionMethod === 'vision'"
              class="rounded-md bg-surface px-2 py-0.5 text-xs text-ink-muted"
            >
              Vision/OCR
            </span>
            <UiButton
              type="button"
              variante="still"
              groesse="sm"
              icon="xmark"
              nur-icon
              title="Andere Datei wählen"
              @click="zuruecksetzen"
            />
          </div>
          <ul v-if="analyse.warnings.length" class="space-y-1 text-sm text-ink-muted">
            <li v-for="(hinweis, i) in analyse.warnings" :key="i">
              {{ hinweis }}
            </li>
          </ul>
        </div>

        <p v-if="fehler" class="mt-3 text-sm text-danger">{{ fehler }}</p>
      </UiCard>

      <template v-if="analyse">
        <UiCard titel="Grundangaben" icon="file-lines" einklappbar einklapp-id="material-ki-grundangaben">
          <div class="space-y-4">
            <UiField label="Titel" pflicht>
              <UiInput v-model="formular.title" placeholder="z. B. AB 1 – Photosynthese" />
            </UiField>
            <UiEinklappbaresFeld
              v-model="formular.description"
              label="Kurzbeschreibung"
              einklapp-id="material-ki-beschreibung"
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

        <UiCard titel="Inhalt / Textfassung" icon="align-left">
          <MaterialInhaltFeld
            v-model="formular.content"
            einklapp-id="material-ki-inhalt"
          />
        </UiCard>

        <UiCard titel="Einordnung" icon="sitemap" einklappbar einklapp-id="material-ki-einordnung">
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
          <UiButton type="button" variante="sekundaer" @click="zuruecksetzen">
            Zurücksetzen
          </UiButton>
          <UiButton
            type="submit"
            variante="primaer"
            icon="check"
            :laedt="laeuft"
            :disabled="!formular.title.trim()"
          >
            Anlegen
          </UiButton>
        </div>
      </template>
    </form>
  </div>
</template>
