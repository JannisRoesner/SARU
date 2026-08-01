<script setup lang="ts">
import {
  materialTypes,
  origins,
  variantKinds,
  materialRelationTypes,
} from '#shared/utils/labels'
import { istKiMusterloesung, kiAutorAnzeige } from '#shared/utils/ki'
import { solutionEditorMode, type SolutionEditorMode } from '#shared/utils/solution-editor'
import { istMoodleKursMaterial, istH5pMaterial, kursarchivErweiterung } from '#shared/utils/moodle'
import type { GradeLevel } from '#shared/utils/jahrgangsstufen'
import type { MaterialDetail } from '~~/server/repositories/material.repository'
import type { StoredStructuredSolution } from '~~/server/database/schema/materials'

const route = useRoute()
const id = computed(() => String(route.params.id))
const { darfBearbeiten } = useSitzung()
const { aufruf, laeuft } = useApi()
const { schlagwortNamen } = useTaxonomie()
const { optionenMitAktuell } = useSchulformen()
const hinweise = useHinweise()

const { data, status, error, refresh } = await useFetch<MaterialDetail>(
  () => `/api/materials/${id.value}`,
)

useHead({ title: () => data.value?.title ?? 'Material' })

const {
  favoritSetzen,
  archivieren,
  duplizieren,
  loeschen,
  alsVerwendetMerken,
} = useMaterialAktionen(() => refresh())

const formular = reactive({
  title: '',
  description: '' as string | null,
  content: '' as string | null,
  notes: '' as string | null,
  materialType: 'arbeitsblatt',
  schoolForm: null as string | null,
  source: '' as string | null,
  author: '' as string | null,
  pages: '' as string | null,
  subjectNames: [] as string[],
  tagNames: [] as string[],
  learningObjectives: [] as string[],
  gradeLevels: [] as GradeLevel[],
})

const schulformOptionen = computed(() =>
  optionenMitAktuell(formular.schoolForm).map((o) => ({ value: o.value, label: o.label })),
)

const geladen = ref(false)

watch(
  data,
  (wert) => {
    if (!wert) return
    formular.title = wert.title
    formular.description = wert.description
    formular.content = wert.content
    formular.notes = wert.notes
    formular.materialType = wert.materialType
    formular.schoolForm = wert.schoolForm
    formular.source = wert.source
    formular.author = wert.author
    formular.pages = wert.pages
    formular.subjectNames = wert.subjects.map((s) => s.name)
    formular.tagNames = wert.tags.map((t) => t.name)
    formular.learningObjectives = [...(wert.learningObjectives ?? [])]
    formular.gradeLevels = [...(wert.gradeLevels ?? [])]
    nextTick(() => {
      geladen.value = true
      autosave.alsGespeichertMarkieren()
    })
  },
  { immediate: true },
)

const autosave = useAutosave(formular, {
  gueltig: () => geladen.value && Boolean(formular.title.trim()) && darfBearbeiten.value,
  speichern: async (daten) => {
    await $fetch(`/api/materials/${id.value}`, {
      method: 'PATCH',
      body: daten,
    })
  },
})

const loeschenOffen = ref(false)
const varianteOffen = ref(false)
const linkOffen = ref(false)
const relationOffen = ref(false)
const kiOffen = ref(false)
const vorschauOffen = ref(false)
const vorschauAssetId = ref<string | null>(null)
const vorschauTitel = ref<string | null>(null)
const aktiveVarianteId = ref<string | null>(null)

const neueVariante = reactive({
  label: '',
  variantKind: 'standard',
  schoolYear: '',
})

function varianteModalOeffnen() {
  if (istMoodleKurs.value) {
    neueVariante.label = ''
    neueVariante.variantKind = 'jahrgang'
    neueVariante.schoolYear = ''
  } else {
    neueVariante.label = ''
    neueVariante.variantKind = 'standard'
    neueVariante.schoolYear = ''
  }
  varianteOffen.value = true
}

const neuerLink = reactive({ url: '', title: '' })
const neueRelation = reactive({
  targetId: '',
  relationType: 'zusatzmaterial',
  note: '',
})
const kiAnweisung = ref('')

async function varianteAnlegen() {
  const body = istMoodleKurs.value
    ? {
        label: neueVariante.label,
        variantKind: neueVariante.variantKind,
        schoolYear: neueVariante.schoolYear.trim() || null,
      }
    : { label: neueVariante.label, variantKind: neueVariante.variantKind }

  const ergebnis = await aufruf(`/api/materials/${id.value}/variants`, {
    method: 'POST',
    body,
    erfolgsmeldung: istMoodleKurs.value ? 'Kursversion angelegt.' : 'Variante angelegt.',
  })
  if (ergebnis) {
    varianteOffen.value = false
    neueVariante.label = ''
    neueVariante.schoolYear = ''
    await refresh()
  }
}

async function dateienHochladen(variantId: string, files: FileList | null) {
  if (!files?.length) return
  const body = new FormData()
  for (const file of Array.from(files)) body.append('files', file)
  body.append('role', istMoodleKurs.value ? 'haupt' : 'anhang')
  const ergebnis = await aufruf<{ erstellt: { id: string }[]; abgelehnt: unknown[] }>(
    `/api/variants/${variantId}/uploads`,
    {
      method: 'POST',
      body,
      erfolgsmeldung: istMoodleKurs.value ? 'Kursarchiv hochgeladen.' : 'Datei(en) hochgeladen.',
    },
  )
  if (ergebnis) await refresh()
}

async function linkHinzufuegen() {
  if (!aktiveVarianteId.value) return
  const ergebnis = await aufruf(`/api/variants/${aktiveVarianteId.value}/links`, {
    method: 'POST',
    body: { url: neuerLink.url, title: neuerLink.title || null },
    erfolgsmeldung: 'Link hinzugefügt.',
  })
  if (ergebnis) {
    linkOffen.value = false
    neuerLink.url = ''
    neuerLink.title = ''
    await refresh()
  }
}

async function assetLoeschen(assetId: string) {
  const ok = await aufruf(`/api/assets/${assetId}`, {
    method: 'DELETE',
    erfolgsmeldung: 'Anhang entfernt.',
  })
  if (ok !== null) await refresh()
}

async function relationHinzufuegen() {
  const ergebnis = await aufruf(`/api/materials/${id.value}/relations`, {
    method: 'POST',
    body: {
      targetId: neueRelation.targetId,
      relationType: neueRelation.relationType,
      note: neueRelation.note || null,
    },
    erfolgsmeldung: 'Verknüpfung angelegt.',
  })
  if (ergebnis) {
    relationOffen.value = false
    neueRelation.targetId = ''
    neueRelation.note = ''
    await refresh()
  }
}

async function relationLoeschen(relationId: string) {
  const ok = await aufruf(`/api/relations/${relationId}`, {
    method: 'DELETE',
    erfolgsmeldung: 'Verknüpfung entfernt.',
  })
  if (ok !== null) await refresh()
}

async function kiLoesung() {
  const ergebnis = await aufruf<{
    solutionMaterialId: string
    fillStrategy?: string
    hermesUsed?: boolean
    fileName?: string | null
  }>(`/api/materials/${id.value}/solution`, {
    method: 'POST',
    body: { userInstructions: kiAnweisung.value || null },
    erfolgsmeldung: 'Musterlösung als Dokument erzeugt.',
  })
  if (ergebnis) {
    kiOffen.value = false
    kiAnweisung.value = ''
    await refresh()
    const strategie = ergebnis.fillStrategy
      ? ` (${ergebnis.fillStrategy}${ergebnis.hermesUsed ? ', Hermes' : ''})`
      : ''
    hinweise.erfolg(`Dokument angelegt${strategie}. Öffnen?`, {
      text: 'Zur Lösung',
      ausfuehren: () => navigateTo(`/materialien/${ergebnis.solutionMaterialId}`),
    })
  }
}

async function materialLoeschen() {
  const ok = await loeschen(id.value)
  loeschenOffen.value = false
  if (ok) await navigateTo('/materialien')
}

function assetOeffnen(asset: {
  id: string
  kind: string
  url: string | null
  title?: string | null
  fileName?: string | null
  mimeType?: string | null
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

async function loesungSpeichern(payload: {
  structuredSolution: StoredStructuredSolution
  reRender: boolean
  reviewed: boolean
}) {
  // Ohne Toast – Status zeigt SpeichernAnzeige im Vorschau-Modal.
  const ergebnis = await $fetch<{
    reRendered: boolean
    material: MaterialDetail
  }>(`/api/materials/${id.value}/solution`, {
    method: 'PATCH',
    body: payload,
  })
  await refresh()
  if (ergebnis.material?.variants) {
    const asset =
      ergebnis.material.variants
        .flatMap((v) => v.assets)
        .find((a) => a.kind === 'datei' && a.role === 'haupt') ??
      ergebnis.material.variants.flatMap((v) => v.assets).find((a) => a.kind === 'datei')
    if (asset) vorschauAssetId.value = asset.id
  }
}

async function geprueftUmschalten(wert: boolean) {
  const ok = await aufruf(`/api/materials/${id.value}/reviewed`, {
    method: 'PATCH',
    body: { reviewed: wert },
    erfolgsmeldung: wert ? 'Als geprüft markiert.' : 'Prüfstatus entfernt.',
  })
  if (ok !== null) await refresh()
}

function assetHerunterladen(assetId: string) {
  void alsVerwendetMerken(id.value)
  window.open(`/api/assets/${assetId}/download`, '_blank')
}

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

const kiLoesungAktiv = computed(() => (data.value ? istKiMusterloesung(data.value) : false))

const istMoodleKurs = computed(() =>
  data.value ? istMoodleKursMaterial(data.value.materialType) : false,
)

const istH5p = computed(() =>
  data.value ? istH5pMaterial(data.value.materialType) : false,
)

const istIconVorschau = computed(() => istMoodleKurs.value || istH5p.value)

const kursarchivFormat = computed(() =>
  kursarchivErweiterung(hauptVorschau.value?.fileName),
)

const kiCredit = computed(() =>
  data.value
    ? kiAutorAnzeige(data.value.aiMeta, data.value.author)
    : null,
)

const loesungStruktur = computed<StoredStructuredSolution | null>(() => {
  const raw = data.value?.aiMeta?.structuredSolution
  if (!raw || !Array.isArray(raw.answers)) return null
  return raw
})

/** PDF-Musterlösung: Overlay-, Anhang- oder Hybrid-Editor je nach fillStrategy. */
const loesungEditorModus = computed<SolutionEditorMode | null>(() => {
  if (!kiLoesungAktiv.value || !loesungStruktur.value || !darfBearbeiten.value) return null
  return solutionEditorMode(data.value?.aiMeta?.fillStrategy)
})

const loesungBearbeitbar = computed(() => loesungEditorModus.value !== null)

</script>

<template>
  <div>
    <UiFehlerzustand v-if="error" :text="toApiFehler(error).nachricht" @erneut="refresh()" />
    <UiSkelett v-else-if="status === 'pending' || !data" art="list" :zeilen="8" />

    <template v-else>
      <div class="mb-2">
        <NuxtLink to="/materialien" class="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary">
          <UiIcon name="arrow-left" fest /> Materialien
        </NuxtLink>
      </div>

      <header class="mb-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div class="min-w-0 max-w-3xl">
          <p class="seitenkopf-kicker">Material</p>
          <h1 class="break-words text-3xl tracking-tight text-ink">{{ data.title }}</h1>
          <div class="mt-3 flex flex-wrap gap-1.5">
            <UiBadge :ton="materialTypes.tone(data.materialType)" :icon="materialTypes.icon(data.materialType)">
              {{ materialTypes.label(data.materialType) }}
            </UiBadge>
            <UiBadge
              v-if="kiCredit"
              ton="ki"
              icon="robot"
            >
              {{ kiCredit }}
            </UiBadge>
            <UiBadge
              v-else-if="data.origin !== 'manuell'"
              :ton="origins.tone(data.origin)"
              :icon="origins.icon(data.origin)"
            >
              {{ origins.label(data.origin) }}
            </UiBadge>
            <UiBadge
              v-if="kiLoesungAktiv && data.aiMeta?.reviewed"
              ton="gruen"
              icon="circle-check"
            >
              Geprüft
            </UiBadge>
            <UiBadge v-for="fach in data.subjects" :key="fach.id" :farbe="fach.color ?? undefined">
              {{ fach.name }}
            </UiBadge>
            <UiBadge v-if="data.isArchived" icon="box-archive">Archiviert</UiBadge>
          </div>
        </div>

        <LayoutAktionen class="sm:ml-auto sm:justify-end">
          <UiSpeichernAnzeige
            v-if="darfBearbeiten"
            :zustand="autosave.zustand.value"
            :fehler="autosave.letzterFehler.value"
            :zuletzt="autosave.zuletztGespeichert.value"
          />
          <UiButton
            variante="still"
            :icon="data.isFavorite ? 'star' : 'star'"
            nur-icon
            :title="data.isFavorite ? 'Favorit entfernen' : 'Als Favorit'"
            @click="favoritSetzen(data.id, !data.isFavorite)"
          />
          <UiButton
            v-if="darfBearbeiten && !kiLoesungAktiv && !istMoodleKurs"
            variante="sekundaer"
            icon="wand-magic-sparkles"
            title="Musterlösung erstellen"
            @click="kiOffen = true"
          >
            <span class="sm:hidden">KI-Lösung</span>
            <span class="hidden sm:inline">Musterlösung erstellen</span>
          </UiButton>
          <UiButton
            v-if="loesungBearbeitbar && hauptVorschau"
            variante="sekundaer"
            icon="pen-to-square"
            title="Antworten korrigieren"
            @click="assetOeffnen(hauptVorschau)"
          >
            <span class="sm:hidden">Korrigieren</span>
            <span class="hidden sm:inline">Antworten korrigieren</span>
          </UiButton>
          <UiButton
            v-if="darfBearbeiten"
            variante="sekundaer"
            icon="copy"
            @click="duplizieren(data.id)"
          >
            Duplizieren
          </UiButton>
          <UiButton
            v-if="darfBearbeiten"
            variante="sekundaer"
            :icon="data.isArchived ? 'box-open' : 'box-archive'"
            @click="archivieren(data.id, !data.isArchived)"
          >
            {{ data.isArchived ? 'Wiederherstellen' : 'Archivieren' }}
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

      <div class="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div class="min-w-0 space-y-5">
          <UiCard
            v-if="hauptVorschau"
            :titel="istMoodleKurs ? 'Kursarchiv' : istH5p ? 'H5P-Paket' : 'Dokumentvorschau'"
            :icon="istMoodleKurs ? 'graduation-cap' : istH5p ? 'puzzle-piece' : 'eye'"
            einklappbar
            :einklapp-id="istMoodleKurs ? 'material-moodle-backup' : istH5p ? 'material-h5p-paket' : 'material-vorschau'"
            :standard-offen="true"
          >
            <div class="flex flex-wrap items-start gap-4">
              <MaterialVorschauMiniatur
                :asset-id="hauptVorschau.id"
                :file-name="hauptVorschau.fileName"
                :mime-type="hauptVorschau.mimeType"
                :material-type="data.materialType"
                groesse="lg"
                :klickbar="!istIconVorschau"
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
                  <p v-if="istMoodleKurs && kursarchivFormat === 'imscc'" class="mt-2 text-sm leading-relaxed text-ink-muted">
                    Diese .imscc-Datei kannst du im SchulMoodle als IMS Common Cartridge importieren.
                  </p>
                  <p v-else-if="istMoodleKurs" class="mt-2 text-sm leading-relaxed text-ink-muted">
                    Dieses Backup kannst du im SchulMoodle unter
                    <strong class="font-medium text-ink">Website-Administration → Kurse → Wiederherstellen</strong>
                    hochladen.
                  </p>
                  <p v-else-if="istH5p" class="mt-2 text-sm leading-relaxed text-ink-muted">
                    Dieses H5P-Paket kannst du im SchulMoodle unter
                    <strong class="font-medium text-ink">Inhalt hinzufügen → H5P</strong>
                    hochladen oder einbetten.
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <UiButton
                    v-if="!istIconVorschau"
                    variante="primaer"
                    icon="eye"
                    @click="assetOeffnen(hauptVorschau)"
                  >
                    {{ loesungBearbeitbar ? 'Vorschau & korrigieren' : 'Vorschau' }}
                  </UiButton>
                  <UiButton
                    :variante="istIconVorschau ? 'primaer' : 'sekundaer'"
                    icon="download"
                    @click="assetHerunterladen(hauptVorschau.id)"
                  >
                    {{ istMoodleKurs ? 'Archiv herunterladen' : istH5p ? 'Paket herunterladen' : 'Download' }}
                  </UiButton>
                </div>
                <UiToggle
                  v-if="kiLoesungAktiv && darfBearbeiten"
                  :model-value="Boolean(data.aiMeta?.reviewed)"
                  label="Fachlich geprüft"
                  hinweis="Markiert die KI-Musterlösung als kontrolliert."
                  @update:model-value="geprueftUmschalten($event)"
                />
              </div>
            </div>
          </UiCard>

          <UiCard
            titel="Angaben"
            icon="pen-to-square"
            einklappbar
            einklapp-id="material-angaben"
            :standard-offen="true"
          >
            <div class="space-y-4">
              <UiField label="Titel" pflicht>
                <UiInput v-model="formular.title" :disabled="!darfBearbeiten" />
              </UiField>
              <UiEinklappbaresFeld
                v-model="formular.description"
                label="Beschreibung"
                :einklapp-id="`material-beschreibung-${id}`"
                leer-vorschau="Keine Beschreibung"
                placeholder="Kurzbeschreibung …"
                :disabled="!darfBearbeiten"
              />
              <div class="grid gap-4 sm:grid-cols-2">
                <UiField label="Materialart">
                  <UiSelect
                    v-model="formular.materialType"
                    :disabled="!darfBearbeiten || istMoodleKurs"
                    :optionen="materialTypes.options().map((o) => ({ value: o.value, label: o.label }))"
                  />
                </UiField>
                <UiField label="Schulform">
                  <UiSelect
                    v-model="formular.schoolForm"
                    platzhalter="–"
                    :disabled="!darfBearbeiten"
                    :optionen="schulformOptionen"
                  />
                </UiField>
              </div>
              <MaterialInhaltFeld
                v-model="formular.content"
                :einklapp-id="`material-inhalt-${id}`"
                :disabled="!darfBearbeiten"
              />
              <UiEinklappbaresFeld
                v-model="formular.notes"
                label="Notizen"
                :einklapp-id="`material-notizen-${id}`"
                leer-vorschau="Keine Notizen"
                placeholder="Interne Notizen …"
                :disabled="!darfBearbeiten"
              />
              <div class="grid gap-4 sm:grid-cols-2">
                <UiField label="Quelle">
                  <UiInput v-model="formular.source" :disabled="!darfBearbeiten" />
                </UiField>
                <UiField
                  label="Autor"
                  :hinweis="kiLoesungAktiv ? 'Bei KI-Musterlösungen das verwendete Modell.' : undefined"
                >
                  <UiInput
                    v-if="!kiLoesungAktiv"
                    v-model="formular.author"
                    :disabled="!darfBearbeiten"
                  />
                  <div
                    v-else
                    class="flex h-10 items-center gap-2 rounded-lg border border-line bg-surface-sunken px-3 text-sm text-ink"
                  >
                    <UiIcon name="robot" class="text-ki-strong" />
                    <span>{{ kiCredit || formular.author || 'KI' }}</span>
                  </div>
                </UiField>
              </div>
              <UiField label="Schlagwörter">
                <UiTagInput
                  v-model="formular.tagNames"
                  :vorschlaege="schlagwortNamen"
                  :disabled="!darfBearbeiten"
                />
              </UiField>
              <UiField label="Lernziele">
                <UiTagInput
                  v-model="formular.learningObjectives"
                  :disabled="!darfBearbeiten"
                  platzhalter="Lernziel …"
                />
              </UiField>
              <UiField label="Jahrgangsstufen">
                <UiJahrgangsstufenAuswahl
                  v-model="formular.gradeLevels"
                  :disabled="!darfBearbeiten"
                />
              </UiField>
              <UiField label="Fächer">
                <MaterialFachAuswahl
                  v-model="formular.subjectNames"
                  :disabled="!darfBearbeiten"
                />
              </UiField>
            </div>
          </UiCard>

          <UiCard
            :titel="istMoodleKurs ? 'Kursversionen' : 'Varianten & Anhänge'"
            :icon="istMoodleKurs ? 'graduation-cap' : 'code-branch'"
            einklappbar
            einklapp-id="material-varianten"
            :standard-offen="!data.variants.some((v) => v.assets.length)"
          >
            <template #kopf>
              <UiButton
                v-if="darfBearbeiten"
                variante="still"
                groesse="sm"
                icon="plus"
                @click="varianteModalOeffnen"
              >
                {{ istMoodleKurs ? 'Kursversion' : 'Variante' }}
              </UiButton>
            </template>

            <p v-if="istMoodleKurs" class="mb-4 text-sm text-ink-muted">
              Pro Schuljahr oder Fassung ein eigenes Kursarchiv (.mbz oder .imscc). Jede Kursversion enthält genau eine Archiv-Datei.
            </p>

            <div v-if="!data.variants.length" class="text-sm text-ink-muted">
              {{ istMoodleKurs
                ? 'Noch keine Kursversion – beim Anlegen wird automatisch eine erste Fassung erzeugt.'
                : 'Noch keine Variante – beim Anlegen wird automatisch eine Standardfassung erzeugt.' }}
            </div>

            <div v-else class="space-y-4">
              <section
                v-for="variante in data.variants"
                :key="variante.id"
                class="rounded-xl border border-line bg-surface-sunken/40 p-4"
              >
                <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 class="font-medium text-ink">
                      {{ variante.label }}
                      <UiBadge v-if="variante.isDefault" groesse="sm" ton="primary">Standard</UiBadge>
                    </h3>
                    <p class="text-xs text-ink-subtle">
                      {{ variantKinds.label(variante.variantKind as never) }}
                      <template v-if="variante.schoolYear"> · {{ variante.schoolYear }}</template>
                    </p>
                  </div>
                  <div v-if="darfBearbeiten" class="flex gap-1.5">
                    <label
                      v-if="!istMoodleKurs || !variante.assets.some((a) => a.kind === 'datei')"
                      class="inline-flex cursor-pointer"
                    >
                      <input
                        type="file"
                        :multiple="!istMoodleKurs"
                        accept=".mbz,.imscc,application/gzip,application/x-gzip,application/zip"
                        class="sr-only"
                        @change="dateienHochladen(variante.id, ($event.target as HTMLInputElement).files); ($event.target as HTMLInputElement).value = ''"
                      >
                      <span class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm hover:bg-surface-hover">
                        <UiIcon :name="istMoodleKurs ? 'graduation-cap' : 'upload'" fest />
                        {{ istMoodleKurs ? 'Archiv hochladen' : 'Hochladen' }}
                      </span>
                    </label>
                    <UiButton
                      v-if="!istMoodleKurs"
                      variante="sekundaer"
                      groesse="sm"
                      icon="link"
                      @click="aktiveVarianteId = variante.id; linkOffen = true"
                    >
                      Link
                    </UiButton>
                  </div>
                </div>

                <ul v-if="variante.assets.length" class="space-y-1.5">
                  <li
                    v-for="asset in variante.assets"
                    :key="asset.id"
                    class="flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-sm"
                  >
                    <MaterialVorschauMiniatur
                      v-if="asset.kind === 'datei'"
                      :asset-id="asset.id"
                      :file-name="asset.fileName"
                      :mime-type="asset.mimeType"
                      :material-type="data.materialType"
                      groesse="sm"
                      :klickbar="!istIconVorschau"
                      @klick="assetOeffnen(asset)"
                    />
                    <UiIcon
                      v-else
                      name="link"
                      fest
                      class="text-ink-subtle"
                    />
                    <button
                      type="button"
                      class="min-w-0 flex-1 truncate text-left font-medium text-ink hover:text-primary"
                      @click="assetOeffnen(asset)"
                    >
                      {{ asset.title || asset.fileName || asset.url }}
                    </button>
                    <span v-if="asset.sizeBytes" class="text-xs text-ink-subtle">
                      {{ formatBytes(asset.sizeBytes) }}
                    </span>
                    <UiButton
                      v-if="asset.kind === 'datei'"
                      variante="still"
                      groesse="sm"
                      icon="download"
                      nur-icon
                      title="Herunterladen"
                      @click="assetHerunterladen(asset.id)"
                    />
                    <UiButton
                      v-if="darfBearbeiten"
                      variante="still"
                      groesse="sm"
                      icon="trash"
                      nur-icon
                      title="Anhang entfernen"
                      @click="assetLoeschen(asset.id)"
                    />
                  </li>
                </ul>
                <p v-else class="text-xs text-ink-subtle">
                  {{ istMoodleKurs ? 'Noch kein Backup hochgeladen' : 'Keine Anhänge' }}
                </p>
              </section>
            </div>
          </UiCard>

          <UiCard
            titel="Verknüpfungen"
            icon="link"
            einklappbar
            einklapp-id="material-verknuepfungen"
            :standard-offen="false"
          >
            <template #kopf>
              <UiButton
                v-if="darfBearbeiten"
                variante="still"
                groesse="sm"
                icon="plus"
                @click="relationOffen = true"
              >
                Verknüpfen
              </UiButton>
            </template>

            <UiLeerzustand
              v-if="!data.relations.length"
              klein
              icon="link"
              titel="Keine Verknüpfungen"
              text="Verbinde Lösungen, Zusatzmaterial oder verwandte Materialien."
            />
            <ul v-else class="space-y-2">
              <li
                v-for="rel in data.relations"
                :key="rel.id"
                class="flex items-center gap-3 rounded-lg border border-line px-3 py-2"
              >
                <UiBadge groesse="sm" :ton="materialRelationTypes.tone(rel.relationType as never)">
                  {{ materialRelationTypes.label(rel.relationType as never) }}
                </UiBadge>
                <NuxtLink
                  :to="`/materialien/${rel.material.id}`"
                  class="min-w-0 flex-1 truncate font-medium hover:text-primary"
                >
                  {{ rel.material.title }}
                </NuxtLink>
                <UiButton
                  v-if="darfBearbeiten"
                  variante="still"
                  groesse="sm"
                  icon="xmark"
                  nur-icon
                  title="Verknüpfung entfernen"
                  @click="relationLoeschen(rel.id)"
                />
              </li>
            </ul>
          </UiCard>
        </div>

        <aside class="min-w-0 space-y-4">
          <UiCard
            titel="Verwendung"
            icon="chalkboard-user"
            blank
            einklappbar
            einklapp-id="material-verwendung"
            :standard-offen="false"
          >
            <div class="p-4">
              <UiLeerzustand
                v-if="!data.usages.length"
                klein
                icon="link-slash"
                titel="Noch nicht verwendet"
                text="Dieses Material ist noch keiner Stunde oder Reihe zugeordnet."
              />
              <ul v-else class="space-y-2">
                <li v-for="(u, i) in data.usages" :key="`${u.kind}-${u.id}-${i}`">
                  <NuxtLink
                    :to="u.kind === 'reihe' ? `/reihen/${u.id}` : `/stunden/${u.id}`"
                    class="block rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover"
                  >
                    <span class="font-medium text-ink">{{ u.title }}</span>
                    <span class="mt-0.5 block text-xs text-ink-subtle">
                      {{ u.kind === 'reihe' ? 'Reihe' : 'Stunde' }}
                      <template v-if="u.date"> · {{ formatDatum(u.date) }}</template>
                    </span>
                  </NuxtLink>
                </li>
              </ul>
            </div>
          </UiCard>

          <UiCard
            titel="Metadaten"
            icon="circle-info"
            einklappbar
            einklapp-id="material-metadaten"
            :standard-offen="false"
          >
            <dl class="space-y-3 text-sm">
              <div>
                <dt class="text-xs text-ink-subtle uppercase tracking-wide">Aktualisiert</dt>
                <dd>{{ formatDatumZeit(data.updatedAt) }}</dd>
              </div>
              <div>
                <dt class="text-xs text-ink-subtle uppercase tracking-wide">Erstellt</dt>
                <dd>{{ formatDatumZeit(data.createdAt) }}</dd>
              </div>
              <div v-if="data.ownerName">
                <dt class="text-xs text-ink-subtle uppercase tracking-wide">Eigentümer</dt>
                <dd>{{ data.ownerName }}</dd>
              </div>
            </dl>
          </UiCard>
        </aside>
      </div>
    </template>

    <UiConfirm
      v-model="loeschenOffen"
      gefahr
      titel="Material löschen?"
      text="Das Material und alle Varianten sowie Anhänge werden unwiderruflich entfernt. Dieser Vorgang kann nicht rückgängig gemacht werden."
      bestaetigen="Ja, ich will löschen"
      @bestaetigt="materialLoeschen"
    />

    <UiModal
      v-model="varianteOffen"
      :titel="istMoodleKurs ? 'Kursversion anlegen' : 'Variante anlegen'"
      :icon="istMoodleKurs ? 'graduation-cap' : 'code-branch'"
    >
      <div class="space-y-4">
        <UiField :label="istMoodleKurs ? 'Bezeichnung' : 'Bezeichnung'" pflicht>
          <UiInput
            v-model="neueVariante.label"
            :placeholder="istMoodleKurs ? 'z. B. 2024/25' : 'z. B. Einfache Fassung'"
          />
        </UiField>
        <UiField v-if="istMoodleKurs" label="Schuljahr">
          <UiInput v-model="neueVariante.schoolYear" placeholder="z. B. 2024/25" />
        </UiField>
        <UiField v-if="!istMoodleKurs" label="Art">
          <UiSelect
            v-model="neueVariante.variantKind"
            :optionen="variantKinds.options().map((o) => ({ value: o.value, label: o.label }))"
          />
        </UiField>
      </div>
      <template #aktionen>
        <UiButton variante="sekundaer" @click="varianteOffen = false">Abbrechen</UiButton>
        <UiButton
          variante="primaer"
          :laedt="laeuft"
          :disabled="!neueVariante.label.trim()"
          @click="varianteAnlegen"
        >
          Anlegen
        </UiButton>
      </template>
    </UiModal>

    <UiModal v-model="linkOffen" titel="Link hinzufügen" icon="link">
      <div class="space-y-4">
        <UiField label="Adresse" pflicht>
          <UiInput v-model="neuerLink.url" placeholder="https://…" />
        </UiField>
        <UiField label="Titel">
          <UiInput v-model="neuerLink.title" />
        </UiField>
      </div>
      <template #aktionen>
        <UiButton variante="sekundaer" @click="linkOffen = false">Abbrechen</UiButton>
        <UiButton variante="primaer" :laedt="laeuft" :disabled="!neuerLink.url" @click="linkHinzufuegen">
          Hinzufügen
        </UiButton>
      </template>
    </UiModal>

    <UiModal v-model="relationOffen" titel="Material verknüpfen" icon="link">
      <div class="space-y-4">
        <UiField label="Ziel-Material-ID" pflicht hinweis="UUID des verknüpften Materials">
          <UiInput v-model="neueRelation.targetId" placeholder="xxxxxxxx-xxxx-…" />
        </UiField>
        <UiField label="Art der Verknüpfung">
          <UiSelect
            v-model="neueRelation.relationType"
            :optionen="materialRelationTypes.options().map((o) => ({ value: o.value, label: o.label }))"
          />
        </UiField>
        <UiField label="Notiz">
          <UiInput v-model="neueRelation.note" />
        </UiField>
      </div>
      <template #aktionen>
        <UiButton variante="sekundaer" @click="relationOffen = false">Abbrechen</UiButton>
        <UiButton
          variante="primaer"
          :laedt="laeuft"
          :disabled="!neueRelation.targetId"
          @click="relationHinzufuegen"
        >
          Verknüpfen
        </UiButton>
      </template>
    </UiModal>

    <UiModal v-model="kiOffen" titel="Musterlösung erstellen" icon="wand-magic-sparkles">
      <div class="mb-4 space-y-2 text-sm text-ink-muted">
        <p>
          Die KI wertet die Quelldatei aus (Vision bei PDF/Bildern) und erzeugt ein
          <strong class="font-medium text-ink">herunterladbares Dokument</strong> –
          möglichst mit ausgefüllten Lücken bzw. Formularfeldern. Das Ergebnis wird als
          KI-Musterlösung verknüpft.
        </p>
        <p>
          Word-Dokumente können bei konfigurierter Collabora-Vorschau direkt geöffnet und
          nachbearbeitet werden. Bei PDFs ohne Formularfelder schreibt die KI die Lösungen
          als Text in die Lücken auf den Originalseiten (visuelles Overlay).
        </p>
        <p v-if="laeuft" class="rounded-lg bg-primary-soft px-3 py-2 text-primary-strong">
          Musterlösung wird erzeugt – je nach Modell und Seitenzahl kann das einige Minuten dauern …
        </p>
      </div>
      <UiField label="Zusätzliche Anweisung">
        <UiTextarea
          v-model="kiAnweisung"
          :zeilen="4"
          placeholder="z. B. Lücken knapp ausfüllen, Erwartungshorizont für offene Aufgaben …"
          :disabled="laeuft"
        />
      </UiField>
      <template #aktionen>
        <UiButton variante="sekundaer" :disabled="laeuft" @click="kiOffen = false">Abbrechen</UiButton>
        <UiButton variante="primaer" icon="wand-magic-sparkles" :laedt="laeuft" @click="kiLoesung">
          Musterlösung erstellen
        </UiButton>
      </template>
    </UiModal>

    <MaterialVorschauModal
      v-model="vorschauOffen"
      :asset-id="vorschauAssetId"
      :titel="vorschauTitel"
      :loesung-bearbeiten="loesungBearbeitbar"
      :editor-modus="loesungEditorModus"
      :struktur="loesungStruktur"
      :material-id="loesungBearbeitbar ? id : null"
      :quellen-asset-id="loesungEditorModus === 'appendix' ? null : (data?.aiMeta?.sourceAssetId ?? null)"
      :modell-credit="kiCredit"
      :geprueft="Boolean(data?.aiMeta?.reviewed)"
      :darf-bearbeiten="darfBearbeiten"
      :bei-speichern="loesungSpeichern"
      @herunterladen="assetHerunterladen"
    />
  </div>
</template>
