<script setup lang="ts">
import {
  materialTypes,
  schoolForms,
  origins,
  variantKinds,
  materialRelationTypes,
} from '#shared/utils/labels'
import type { MaterialDetail } from '~~/server/repositories/material.repository'

const route = useRoute()
const id = computed(() => String(route.params.id))
const { darfBearbeiten } = useSitzung()
const { aufruf, laeuft } = useApi()
const { fachOptionen, schlagwortNamen } = useTaxonomie()
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
  subjectIds: [] as string[],
  tagNames: [] as string[],
  learningObjectives: [] as string[],
  gradeLevels: [] as number[],
})

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
    formular.subjectIds = wert.subjects.map((s) => s.id)
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
const aktiveVarianteId = ref<string | null>(null)

const neueVariante = reactive({
  label: '',
  variantKind: 'standard',
})

const neuerLink = reactive({ url: '', title: '' })
const neueRelation = reactive({
  targetId: '',
  relationType: 'zusatzmaterial',
  note: '',
})
const kiAnweisung = ref('')

async function varianteAnlegen() {
  const ergebnis = await aufruf(`/api/materials/${id.value}/variants`, {
    method: 'POST',
    body: { ...neueVariante },
    erfolgsmeldung: 'Variante angelegt.',
  })
  if (ergebnis) {
    varianteOffen.value = false
    neueVariante.label = ''
    await refresh()
  }
}

async function dateienHochladen(variantId: string, files: FileList | null) {
  if (!files?.length) return
  const body = new FormData()
  for (const file of Array.from(files)) body.append('files', file)
  body.append('role', 'anhang')
  const ergebnis = await aufruf<{ erstellt: { id: string }[]; abgelehnt: unknown[] }>(
    `/api/variants/${variantId}/uploads`,
    { method: 'POST', body, erfolgsmeldung: 'Datei(en) hochgeladen.' },
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
  const ergebnis = await aufruf<{ solutionMaterialId: string }>(
    `/api/materials/${id.value}/solution`,
    {
      method: 'POST',
      body: { userInstructions: kiAnweisung.value || null },
      erfolgsmeldung: 'Musterlösung erzeugt.',
    },
  )
  if (ergebnis) {
    kiOffen.value = false
    kiAnweisung.value = ''
    await refresh()
    hinweise.erfolg('Lösung öffnen?', {
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

function assetOeffnen(asset: { id: string; kind: string; url: string | null }) {
  void alsVerwendetMerken(id.value)
  if (asset.kind === 'link' && asset.url) {
    window.open(asset.url, '_blank', 'noopener')
    return
  }
  window.open(`/api/assets/${asset.id}/download`, '_blank')
}

const jahreText = computed({
  get: () => formular.gradeLevels.join(', '),
  set: (wert: string) => {
    formular.gradeLevels = wert
      .split(/[,;\s]+/)
      .map((t) => Number(t.trim()))
      .filter((n) => n >= 1 && n <= 13)
  },
})
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

      <header class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0 max-w-3xl">
          <p class="seitenkopf-kicker">Material</p>
          <h1 class="text-3xl tracking-tight text-ink">{{ data.title }}</h1>
          <div class="mt-3 flex flex-wrap gap-1.5">
            <UiBadge :ton="materialTypes.tone(data.materialType)" :icon="materialTypes.icon(data.materialType)">
              {{ materialTypes.label(data.materialType) }}
            </UiBadge>
            <UiBadge v-if="data.origin !== 'manuell'" :ton="origins.tone(data.origin)" :icon="origins.icon(data.origin)">
              {{ origins.label(data.origin) }}
            </UiBadge>
            <UiBadge v-for="fach in data.subjects" :key="fach.id" :farbe="fach.color ?? undefined">
              {{ fach.name }}
            </UiBadge>
            <UiBadge v-if="data.isArchived" icon="box-archive">Archiviert</UiBadge>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
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
            v-if="darfBearbeiten"
            variante="sekundaer"
            icon="wand-magic-sparkles"
            @click="kiOffen = true"
          >
            KI-Lösung
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
        </div>
      </header>

      <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div class="space-y-5">
          <UiCard titel="Angaben" icon="pen-to-square">
            <div class="space-y-4">
              <UiField label="Titel" pflicht>
                <UiInput v-model="formular.title" :disabled="!darfBearbeiten" />
              </UiField>
              <UiField label="Beschreibung">
                <UiTextarea v-model="formular.description" :zeilen="3" :disabled="!darfBearbeiten" />
              </UiField>
              <div class="grid gap-4 sm:grid-cols-2">
                <UiField label="Materialart">
                  <UiSelect
                    v-model="formular.materialType"
                    :disabled="!darfBearbeiten"
                    :optionen="materialTypes.options().map((o) => ({ value: o.value, label: o.label }))"
                  />
                </UiField>
                <UiField label="Schulform">
                  <UiSelect
                    v-model="formular.schoolForm"
                    platzhalter="–"
                    :disabled="!darfBearbeiten"
                    :optionen="schoolForms.options().map((o) => ({ value: o.value, label: o.label }))"
                  />
                </UiField>
              </div>
              <UiField label="Inhalt / Textfassung">
                <UiTextarea v-model="formular.content" :zeilen="6" :disabled="!darfBearbeiten" />
              </UiField>
              <UiField label="Notizen">
                <UiTextarea v-model="formular.notes" :zeilen="3" :disabled="!darfBearbeiten" />
              </UiField>
              <div class="grid gap-4 sm:grid-cols-2">
                <UiField label="Quelle">
                  <UiInput v-model="formular.source" :disabled="!darfBearbeiten" />
                </UiField>
                <UiField label="Autor">
                  <UiInput v-model="formular.author" :disabled="!darfBearbeiten" />
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
              <UiField label="Jahrgangsstufen" hinweis="Kommagetrennt, z. B. 5, 6, 7">
                <UiInput v-model="jahreText" :disabled="!darfBearbeiten" placeholder="5, 6, 7" />
              </UiField>
              <UiField label="Fächer">
                <select
                  multiple
                  class="min-h-24 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm disabled:opacity-60"
                  :disabled="!darfBearbeiten"
                  :value="formular.subjectIds"
                  @change="formular.subjectIds = Array.from(($event.target as HTMLSelectElement).selectedOptions).map((o) => o.value)"
                >
                  <option v-for="fach in fachOptionen" :key="fach.value" :value="fach.value">
                    {{ fach.label }}
                  </option>
                </select>
              </UiField>
            </div>
          </UiCard>

          <UiCard titel="Varianten & Anhänge" icon="code-branch">
            <template #kopf>
              <UiButton
                v-if="darfBearbeiten"
                variante="still"
                groesse="sm"
                icon="plus"
                @click="varianteOffen = true"
              >
                Variante
              </UiButton>
            </template>

            <div v-if="!data.variants.length" class="text-sm text-ink-muted">
              Noch keine Variante – beim Anlegen wird automatisch eine Standardfassung erzeugt.
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
                    <label class="inline-flex cursor-pointer">
                      <input
                        type="file"
                        multiple
                        class="sr-only"
                        @change="dateienHochladen(variante.id, ($event.target as HTMLInputElement).files)"
                      >
                      <span class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm hover:bg-surface-hover">
                        <UiIcon name="upload" fest /> Datei
                      </span>
                    </label>
                    <UiButton
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
                    <UiIcon :name="asset.kind === 'link' ? 'link' : dateiIcon(asset.fileName)" fest class="text-ink-subtle" />
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
                <p v-else class="text-xs text-ink-subtle">Keine Anhänge</p>
              </section>
            </div>
          </UiCard>

          <UiCard titel="Verknüpfungen" icon="link">
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

        <aside class="space-y-4">
          <UiCard titel="Verwendung" icon="chalkboard-user" blank>
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

          <UiCard titel="Metadaten" icon="circle-info">
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
      text="Das Material und alle Varianten sowie Anhänge werden unwiderruflich entfernt."
      bestaetigen="Löschen"
      tipp-bestaetigung="LÖSCHEN"
      @bestaetigt="materialLoeschen"
    />

    <UiModal v-model="varianteOffen" titel="Variante anlegen" icon="code-branch">
      <div class="space-y-4">
        <UiField label="Bezeichnung" pflicht>
          <UiInput v-model="neueVariante.label" placeholder="z. B. Einfache Fassung" />
        </UiField>
        <UiField label="Art">
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

    <UiModal v-model="kiOffen" titel="Musterlösung mit KI" icon="wand-magic-sparkles">
      <p class="mb-4 text-sm text-ink-muted">
        Es wird ein neues, als KI-Erzeugnis gekennzeichnetes Material angelegt und als Lösung verknüpft.
      </p>
      <UiField label="Zusätzliche Anweisung">
        <UiTextarea
          v-model="kiAnweisung"
          :zeilen="4"
          placeholder="z. B. Lösungsschritte ausführlich erklären …"
        />
      </UiField>
      <template #aktionen>
        <UiButton variante="sekundaer" @click="kiOffen = false">Abbrechen</UiButton>
        <UiButton variante="primaer" icon="wand-magic-sparkles" :laedt="laeuft" @click="kiLoesung">
          Erzeugen
        </UiButton>
      </template>
    </UiModal>
  </div>
</template>
