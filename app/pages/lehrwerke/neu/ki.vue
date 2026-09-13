<script setup lang="ts">
import { aiMaterialAcceptAttribute, aiMaterialFormatsLabel } from '#shared/utils/ai-material-formats'
import type { GradeLevel } from '#shared/utils/jahrgangsstufen'
import { materialPfad } from '#shared/utils/material-pfad'
import type { MaterialDetail } from '~~/server/repositories/material.repository'

definePageMeta({ middleware: [] })
useHead({ title: 'Lehrwerk mit KI anlegen' })

const { darfBearbeiten } = useSitzung()
const { aufruf, laeuft } = useApi()
const { schlagwortNamen } = useTaxonomie()

if (!darfBearbeiten.value) {
  await navigateTo('/lehrwerke')
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
    subjectNames: string[]
    tagNames: string[]
    description: string
    contentSummary: string
    gradeLevels: GradeLevel[]
    aiUsed: boolean
  }
  warnings: string[]
}

const analyse = ref<AnalyseErgebnis | null>(null)
const analysiertLaeuft = ref(false)
const analyseDateiname = ref<string | null>(null)
const fehler = ref<string | null>(null)
const ziehe = ref(false)
const dateiInput = ref<HTMLInputElement | null>(null)

const kiVorschlaegeFehlgeschlagen = computed(
  () =>
    Boolean(
      analyse.value?.aiEnabled
      && analyse.value.hasText
      && !analyse.value.suggestions.aiUsed,
    ),
)

const formular = reactive({
  title: '',
  description: '',
  source: '',
  author: '',
  subjectNames: [] as string[],
  gradeLevels: [] as GradeLevel[],
  tagNames: [] as string[],
})

const ACCEPT = aiMaterialAcceptAttribute()
const FORMAT_HINWEIS = aiMaterialFormatsLabel()

async function dateiAnalysieren(files: FileList | null | undefined) {
  if (analysiertLaeuft.value) return

  fehler.value = null
  const file = files?.[0]
  if (!file) return

  if (analyse.value?.analyzeId) {
    await $fetch(`/api/materials/ai/${analyse.value.analyzeId}`, {
      method: 'DELETE',
    }).catch(() => {})
  }

  analyse.value = null
  analysiertLaeuft.value = true
  analyseDateiname.value = file.name

  try {
    const ergebnis = await analysiereKiMaterial(file, { defaultMaterialType: 'lehrwerk' })
    analyse.value = ergebnis
    formular.title = ergebnis.suggestions.title
    formular.description = ergebnis.suggestions.description || ergebnis.suggestions.contentSummary
    formular.subjectNames = [...ergebnis.suggestions.subjectNames]
    formular.tagNames = [...ergebnis.suggestions.tagNames]
    formular.gradeLevels = [...(ergebnis.suggestions.gradeLevels ?? [])]
  } catch (error) {
    analyse.value = null
    fehler.value = toApiFehler(error).nachricht
  } finally {
    analysiertLaeuft.value = false
    analyseDateiname.value = null
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
        materialType: 'lehrwerk',
        source: formular.source || null,
        author: formular.author || null,
        subjectNames: formular.subjectNames,
        gradeLevels: formular.gradeLevels,
        tagNames: formular.tagNames,
      },
      erfolgsmeldung: 'Lehrwerk mit KI-Vorschlägen angelegt.',
    },
  )
  if (!ergebnis) return
  analyse.value = null
  await navigateTo(materialPfad(ergebnis))
}

async function zuruecksetzen() {
  if (analysiertLaeuft.value) return

  if (analyse.value?.analyzeId) {
    await $fetch(`/api/materials/ai/${analyse.value.analyzeId}`, {
      method: 'DELETE',
    }).catch(() => {})
  }
  analyse.value = null
  fehler.value = null
  formular.title = ''
  formular.description = ''
  formular.source = ''
  formular.author = ''
  formular.subjectNames = []
  formular.gradeLevels = []
  formular.tagNames = []
}
</script>

<template>
  <div>
    <LayoutSeitenkopf
      zurueck-to="/lehrwerke/neu"
      zurueck-label="Wege zum Anlegen"
      kicker="Lehrwerke"
      titel="Mit KI anlegen"
      untertitel="Aus der Buchdatei"
    />

    <form class="space-y-5" @submit.prevent="anlegen">
      <UiCard titel="Buchdatei" icon="wand-magic-sparkles">
        <div
          v-if="analysiertLaeuft"
          class="rounded-xl border border-line bg-surface-sunken/40 px-6 py-10 text-center"
          aria-busy="true"
          aria-live="polite"
        >
          <UiIcon name="circle-notch" dreht fest class="mb-3 text-3xl text-primary" />
          <p class="font-medium text-ink">Datei wird analysiert …</p>
          <p v-if="analyseDateiname" class="mt-1 truncate text-sm text-ink-muted">
            {{ analyseDateiname }}
          </p>
          <p class="mt-2 text-xs text-ink-subtle">
            Text wird extrahiert und KI-Vorschläge erstellt – bei ganzen Büchern kann das etwas länger dauern.
          </p>
        </div>

        <div
          v-else-if="!analyse"
          class="rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors"
          :class="ziehe ? 'border-primary bg-primary-soft/40' : 'border-line bg-surface-sunken/40'"
          @dragover.prevent="ziehe = true"
          @dragleave.prevent="ziehe = false"
          @drop.prevent="ziehe = false; dateiAnalysieren(($event as DragEvent).dataTransfer?.files)"
        >
          <UiIcon name="cloud-arrow-up" class="mb-3 text-3xl text-primary" />
          <p class="font-medium text-ink">Buchdatei hier ablegen</p>
          <p class="mt-1 text-sm text-ink-muted">
            {{ FORMAT_HINWEIS }} – meist die PDF des Schülerbuchs
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
          <div
            v-if="kiVorschlaegeFehlgeschlagen"
            class="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-ink"
          >
            KI-Vorschläge konnten nicht erzeugt werden – nur der Titel stammt aus dem Dateinamen.
            Felder manuell ausfüllen oder die Datei erneut hochladen.
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
        <UiCard titel="Angaben" icon="book" einklappbar einklapp-id="lehrwerk-ki-angaben">
          <div class="space-y-4">
            <UiField label="Titel" pflicht>
              <UiInput v-model="formular.title" placeholder="z. B. Klett Biologie Oberstufe" />
            </UiField>
            <UiEinklappbaresFeld
              v-model="formular.description"
              label="Kurzbeschreibung"
              einklapp-id="lehrwerk-ki-beschreibung"
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
          </div>
        </UiCard>

        <UiCard titel="Einordnung" icon="sitemap" einklappbar einklapp-id="lehrwerk-ki-einordnung">
          <div class="space-y-4">
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
