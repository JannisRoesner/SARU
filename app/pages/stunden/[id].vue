<script setup lang="ts">
import {
  lessonStatuses,
  socialForms,
  materialUsages,
  materialTypes,
  phaseSuggestions,
  methodSuggestions,
} from '#shared/utils/labels'
import type { LessonDetail, LessonPhaseDetail } from '~~/server/repositories/lesson.repository'
import type { MaterialSummary } from '~~/server/repositories/material.repository'

const route = useRoute()
const id = computed(() => String(route.params.id))
const { darfBearbeiten } = useSitzung()
const { aufruf, laeuft } = useApi()
const { fachOptionen, lerngruppenOptionen, themenOptionen, schlagwortNamen } = useTaxonomie()

const { data, status, error, refresh } = await useFetch<LessonDetail>(
  () => `/api/lessons/${id.value}`,
)

useHead({ title: () => data.value?.title ?? 'Stunde' })

const formular = reactive({
  title: '',
  date: null as string | null,
  scheduleNote: null as string | null,
  periodFrom: null as number | null,
  periodTo: null as number | null,
  durationMinutes: null as number | null,
  subjectId: null as string | null,
  learningGroupId: null as string | null,
  topicId: null as string | null,
  status: 'entwurf',
  learningObjectives: [] as string[],
  methodSummary: null as string | null,
  homework: null as string | null,
  notes: null as string | null,
  reflection: null as string | null,
  substituteTeacher: null as string | null,
  tagNames: [] as string[],
})

const geladen = ref(false)
const phasen = ref<LessonPhaseDetail[]>([])
const phasenBehaelter = ref<HTMLElement | null>(null)
const materialBehaelter = ref<HTMLElement | null>(null)
const materialModal = ref(false)
const loeschenOffen = ref(false)
const phaseMaterialZiel = ref<string | null>(null)

watch(
  data,
  (wert) => {
    if (!wert) return
    formular.title = wert.title
    formular.date = wert.date
    formular.scheduleNote = wert.scheduleNote
    formular.periodFrom = wert.periodFrom
    formular.periodTo = wert.periodTo
    formular.durationMinutes = wert.durationMinutes
    formular.subjectId = wert.subject?.id ?? null
    formular.learningGroupId = wert.learningGroup?.id ?? null
    formular.topicId = wert.topic?.id ?? null
    formular.status = wert.status
    formular.learningObjectives = [...(wert.learningObjectives ?? [])]
    formular.methodSummary = wert.methodSummary
    formular.homework = wert.homework
    formular.notes = wert.notes
    formular.reflection = wert.reflection
    formular.substituteTeacher = wert.substituteTeacher
    formular.tagNames = wert.tags.map((t) => t.name)
    phasen.value = structuredClone(toRaw(wert.phases ?? []))
    nextTick(() => {
      geladen.value = true
      autosave.alsGespeichertMarkieren()
    })
  },
  { immediate: true },
)

const autosave = useAutosave(formular, {
  gueltig: () => geladen.value && Boolean(formular.title.trim()) && darfBearbeiten.value,
  speichern: (daten) =>
    $fetch(`/api/lessons/${id.value}`, { method: 'PATCH', body: daten }),
})

useSortierbar(phasenBehaelter, {
  griff: '[data-griff="phase"]',
  deaktiviert: computed(() => !darfBearbeiten.value),
  beiUmsortierung: async (ids) => {
    await aufruf(`/api/lessons/${id.value}/phases/reorder`, {
      method: 'PATCH',
      body: { ids },
    })
    await refresh()
  },
})

useSortierbar(materialBehaelter, {
  griff: '[data-griff="material"]',
  deaktiviert: computed(() => !darfBearbeiten.value),
  beiUmsortierung: async (ids) => {
    await aufruf(`/api/lessons/${id.value}/materials/reorder`, {
      method: 'PATCH',
      body: { ids },
    })
    await refresh()
  },
})

async function phaseHinzufuegen(name?: string) {
  const ergebnis = await aufruf(`/api/lessons/${id.value}/phases`, {
    method: 'POST',
    body: { name: name || `Phase ${phasen.value.length + 1}` },
  })
  if (ergebnis) await refresh()
}

async function phaseSpeichern(phase: LessonPhaseDetail) {
  if (!darfBearbeiten.value) return
  await aufruf(`/api/phases/${phase.id}`, {
    method: 'PATCH',
    body: {
      name: phase.name,
      durationMinutes: phase.durationMinutes,
      content: phase.content,
      teacherActivity: phase.teacherActivity,
      studentActivity: phase.studentActivity,
      method: phase.method,
      socialForm: phase.socialForm,
      notes: phase.notes,
    },
    stumm: true,
  }).catch(() => undefined)
}

async function phaseLoeschen(phaseId: string) {
  const ok = await aufruf(`/api/phases/${phaseId}`, {
    method: 'DELETE',
    erfolgsmeldung: 'Phase entfernt.',
  })
  if (ok !== null) await refresh()
}

async function materialHinzufuegen(material: MaterialSummary) {
  if (phaseMaterialZiel.value) {
    await aufruf(`/api/phases/${phaseMaterialZiel.value}/materials`, {
      method: 'POST',
      body: { materialId: material.id },
      erfolgsmeldung: 'Material der Phase zugeordnet.',
    })
    phaseMaterialZiel.value = null
  } else {
    await aufruf(`/api/lessons/${id.value}/materials`, {
      method: 'POST',
      body: { materialId: material.id, usage: 'unterricht' },
      erfolgsmeldung: 'Material hinzugefügt.',
    })
  }
  await refresh()
}

async function lessonMaterialEntfernen(linkId: string) {
  const ok = await aufruf(`/api/lesson-materials/${linkId}`, {
    method: 'DELETE',
    erfolgsmeldung: 'Zuordnung entfernt.',
  })
  if (ok !== null) await refresh()
}

async function phaseMaterialEntfernen(linkId: string) {
  const ok = await aufruf(`/api/phase-materials/${linkId}`, {
    method: 'DELETE',
  })
  if (ok !== null) await refresh()
}

async function stundeLoeschen() {
  const ok = await aufruf(`/api/lessons/${id.value}`, {
    method: 'DELETE',
    erfolgsmeldung: 'Stunde gelöscht.',
  })
  loeschenOffen.value = false
  if (ok !== null) await navigateTo('/stunden')
}

async function duplizieren() {
  const ergebnis = await aufruf<{ id: string }>(`/api/lessons/${id.value}/duplicate`, {
    method: 'POST',
    erfolgsmeldung: 'Kopie angelegt.',
  })
  if (ergebnis) await navigateTo(`/stunden/${ergebnis.id}`)
}

const gesamtDauer = computed(() =>
  phasen.value.reduce((sum, p) => sum + (p.durationMinutes ?? 0), 0),
)

let phaseTimer: ReturnType<typeof setTimeout> | undefined
function phaseGeaendert(phase: LessonPhaseDetail) {
  clearTimeout(phaseTimer)
  phaseTimer = setTimeout(() => void phaseSpeichern(phase), 900)
}
</script>

<template>
  <div>
    <UiFehlerzustand v-if="error" :text="toApiFehler(error).nachricht" @erneut="refresh()" />
    <UiSkelett v-else-if="status === 'pending' || !data" art="list" :zeilen="8" />

    <template v-else>
      <div class="mb-2">
        <NuxtLink to="/stunden" class="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary">
          <UiIcon name="arrow-left" fest /> Stunden
        </NuxtLink>
      </div>

      <header class="mb-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div class="min-w-0">
          <p class="seitenkopf-kicker">Unterrichtsstunde</p>
          <h1 class="break-words text-3xl tracking-tight text-ink">{{ data.title }}</h1>
          <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-muted">
            <span v-if="data.date">{{ formatDatumLang(data.date) }}</span>
            <span v-if="data.subject">{{ data.subject.name }}</span>
            <span v-if="data.learningGroup">{{ data.learningGroup.name }}</span>
            <span v-if="gesamtDauer">{{ formatDauer(gesamtDauer) }} Phasen</span>
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
            :to="`/stunden/${id}/drucken`"
            variante="sekundaer"
            icon="print"
          >
            Drucken
          </UiButton>
          <UiButton
            v-if="darfBearbeiten"
            variante="sekundaer"
            icon="copy"
            @click="duplizieren"
          >
            Duplizieren
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

      <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div class="space-y-5">
          <UiCard titel="Rahmen" icon="sliders" einklappbar einklapp-id="stunde-rahmen" :standard-offen="true">
            <div class="grid gap-4 sm:grid-cols-2">
              <UiField label="Titel" pflicht class="sm:col-span-2">
                <UiInput v-model="formular.title" :disabled="!darfBearbeiten" />
              </UiField>
              <UiField label="Datum">
                <UiInput v-model="formular.date" type="date" :disabled="!darfBearbeiten" />
              </UiField>
              <UiField label="Status">
                <UiSelect
                  v-model="formular.status"
                  :disabled="!darfBearbeiten"
                  :optionen="lessonStatuses.options().map((o) => ({ value: o.value, label: o.label }))"
                />
              </UiField>
              <UiField label="Von / Bis Stunde">
                <div class="flex gap-2">
                  <UiInput v-model="formular.periodFrom" type="number" min="0" max="20" :disabled="!darfBearbeiten" />
                  <UiInput v-model="formular.periodTo" type="number" min="0" max="20" :disabled="!darfBearbeiten" />
                </div>
              </UiField>
              <UiField label="Dauer (Min.)">
                <UiInput v-model="formular.durationMinutes" type="number" min="0" :disabled="!darfBearbeiten" />
              </UiField>
              <UiField label="Fach">
                <UiSelect v-model="formular.subjectId" platzhalter="–" :disabled="!darfBearbeiten" :optionen="fachOptionen" />
              </UiField>
              <UiField label="Lerngruppe">
                <UiSelect v-model="formular.learningGroupId" platzhalter="–" :disabled="!darfBearbeiten" :optionen="lerngruppenOptionen" />
              </UiField>
              <UiField label="Thema" class="sm:col-span-2">
                <UiSelect v-model="formular.topicId" platzhalter="–" :disabled="!darfBearbeiten" :optionen="themenOptionen" />
              </UiField>
              <UiEinklappbaresFeld
                v-model="formular.methodSummary"
                label="Methodenübersicht"
                :einklapp-id="`stunde-methoden-${id}`"
                class="sm:col-span-2"
                leer-vorschau="Keine Methodenübersicht"
                placeholder="Überblick über Methoden und Sozialformen …"
                :disabled="!darfBearbeiten"
              />
              <UiEinklappbaresFeld
                v-model="formular.homework"
                label="Hausaufgabe"
                :einklapp-id="`stunde-hausaufgabe-${id}`"
                class="sm:col-span-2"
                leer-vorschau="Keine Hausaufgabe"
                placeholder="Aufgabe für die nächste Stunde …"
                :disabled="!darfBearbeiten"
              />
              <UiField label="Lernziele" class="sm:col-span-2">
                <UiTagInput v-model="formular.learningObjectives" :disabled="!darfBearbeiten" />
              </UiField>
              <UiField label="Schlagwörter" class="sm:col-span-2">
                <UiTagInput v-model="formular.tagNames" :vorschlaege="schlagwortNamen" :disabled="!darfBearbeiten" />
              </UiField>
              <UiEinklappbaresFeld
                v-model="formular.notes"
                label="Notizen"
                :einklapp-id="`stunde-notizen-${id}`"
                class="sm:col-span-2"
                leer-vorschau="Keine Notizen"
                placeholder="Planungshinweise, Materialien, Besonderheiten …"
                :disabled="!darfBearbeiten"
              />
              <UiEinklappbaresFeld
                v-model="formular.reflection"
                label="Reflexion"
                :einklapp-id="`stunde-reflexion-${id}`"
                class="sm:col-span-2"
                leer-vorschau="Keine Reflexion"
                placeholder="Nachbereitung, was lief gut, was ändern …"
                :disabled="!darfBearbeiten"
              />
            </div>
          </UiCard>

          <UiCard titel="Phasenverlauf" icon="list-ol" einklappbar einklapp-id="stunde-phasen" :standard-offen="false">
            <template #kopf>
              <div v-if="darfBearbeiten" class="flex flex-wrap gap-1">
                <UiButton
                  v-for="vorschlag in phaseSuggestions.slice(0, 4)"
                  :key="vorschlag"
                  variante="still"
                  groesse="sm"
                  @click="phaseHinzufuegen(vorschlag)"
                >
                  {{ vorschlag }}
                </UiButton>
                <UiButton variante="sekundaer" groesse="sm" icon="plus" @click="phaseHinzufuegen()">
                  Phase
                </UiButton>
              </div>
            </template>

            <UiLeerzustand
              v-if="!phasen.length"
              klein
              icon="list-ol"
              titel="Noch keine Phasen"
              text="Baue den Stundenverlauf aus Einstieg, Erarbeitung und Sicherung auf."
            />

            <div ref="phasenBehaelter" class="space-y-3">
              <article
                v-for="(phase, index) in phasen"
                :key="phase.id"
                :data-id="phase.id"
                class="karte overflow-hidden"
              >
                <div class="flex items-center gap-2 border-b border-line bg-surface-sunken/50 px-3 py-2">
                  <button
                    v-if="darfBearbeiten"
                    type="button"
                    data-griff="phase"
                    class="cursor-grab px-1 text-ink-subtle hover:text-ink"
                    title="Ziehen zum Sortieren"
                  >
                    <UiIcon name="grip-vertical" fest />
                  </button>
                  <span class="text-xs font-semibold text-ink-subtle">{{ index + 1 }}</span>
                  <input
                    v-model="phase.name"
                    class="min-w-0 flex-1 bg-transparent text-sm font-semibold text-ink outline-none"
                    :disabled="!darfBearbeiten"
                    @input="phaseGeaendert(phase)"
                  >
                  <input
                    v-model.number="phase.durationMinutes"
                    type="number"
                    min="0"
                    class="w-16 rounded border border-line bg-surface px-2 py-1 text-xs"
                    :disabled="!darfBearbeiten"
                    title="Minuten"
                    @input="phaseGeaendert(phase)"
                  >
                  <span class="text-xs text-ink-subtle">Min.</span>
                  <UiButton
                    v-if="darfBearbeiten"
                    variante="still"
                    groesse="sm"
                    icon="trash"
                    nur-icon
                    title="Phase löschen"
                    @click="phaseLoeschen(phase.id)"
                  />
                </div>

                <div class="grid gap-3 p-3 sm:grid-cols-2">
                  <UiEinklappbaresFeld
                    v-model="phase.content"
                    label="Inhalt"
                    :einklapp-id="`stunde-phase-inhalt-${phase.id}`"
                    leer-vorschau="Kein Inhalt"
                    placeholder="Was passiert in dieser Phase …"
                    :disabled="!darfBearbeiten"
                    @update:model-value="phaseGeaendert(phase)"
                  />
                  <UiField label="Methode">
                    <UiInput
                      v-model="phase.method"
                      :disabled="!darfBearbeiten"
                      list="methoden-liste"
                      @update:model-value="phaseGeaendert(phase)"
                    />
                  </UiField>
                  <UiField label="Lehrkraft">
                    <UiTextarea
                      v-model="phase.teacherActivity"
                      :zeilen="2"
                      :disabled="!darfBearbeiten"
                      @update:model-value="phaseGeaendert(phase)"
                    />
                  </UiField>
                  <UiField label="Lernende">
                    <UiTextarea
                      v-model="phase.studentActivity"
                      :zeilen="2"
                      :disabled="!darfBearbeiten"
                      @update:model-value="phaseGeaendert(phase)"
                    />
                  </UiField>
                  <UiField label="Sozialform">
                    <UiSelect
                      v-model="phase.socialForm"
                      platzhalter="–"
                      :disabled="!darfBearbeiten"
                      :optionen="socialForms.options().map((o) => ({ value: o.value, label: o.label }))"
                      @update:model-value="phaseGeaendert(phase)"
                    />
                  </UiField>
                </div>

                <div class="border-t border-line px-3 py-2">
                  <div class="mb-1.5 flex items-center justify-between">
                    <p class="text-xs font-medium text-ink-subtle uppercase tracking-wide">
                      Materialien der Phase
                    </p>
                    <UiButton
                      v-if="darfBearbeiten"
                      variante="still"
                      groesse="sm"
                      icon="plus"
                      @click="phaseMaterialZiel = phase.id; materialModal = true"
                    >
                      Hinzufügen
                    </UiButton>
                  </div>
                  <ul v-if="phase.materials?.length" class="space-y-1">
                    <li
                      v-for="mat in phase.materials"
                      :key="mat.id"
                      class="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-surface-hover"
                    >
                      <NuxtLink :to="`/materialien/${mat.materialId}`" class="flex-1 truncate hover:text-primary">
                        {{ mat.title }}
                      </NuxtLink>
                      <UiButton
                        v-if="darfBearbeiten"
                        variante="still"
                        groesse="sm"
                        icon="xmark"
                        nur-icon
                        title="Entfernen"
                        @click="phaseMaterialEntfernen(mat.id)"
                      />
                    </li>
                  </ul>
                  <p v-else class="text-xs text-ink-subtle">Keine Materialien</p>
                </div>
              </article>
            </div>
            <datalist id="methoden-liste">
              <option v-for="m in methodSuggestions" :key="m" :value="m" />
            </datalist>
          </UiCard>
        </div>

        <aside class="space-y-4">
          <UiCard titel="Stundenmaterialien" icon="folder-open" einklappbar einklapp-id="stunde-materialien" :standard-offen="false">
            <template #kopf>
              <UiButton
                v-if="darfBearbeiten"
                variante="sekundaer"
                groesse="sm"
                icon="plus"
                nur-icon
                title="Hinzufügen"
                @click="phaseMaterialZiel = null; materialModal = true"
              />
            </template>

            <UiLeerzustand
              v-if="!data.materials.length"
              klein
              icon="folder-open"
              titel="Keine Materialien"
              text="Ordne Arbeitsblätter und Medien dieser Stunde zu."
            />
            <div ref="materialBehaelter" class="space-y-1.5">
              <div
                v-for="mat in data.materials"
                :key="mat.id"
                :data-id="mat.id"
                class="flex items-center gap-2 rounded-lg border border-line px-2 py-2"
              >
                <button
                  v-if="darfBearbeiten"
                  type="button"
                  data-griff="material"
                  class="cursor-grab text-ink-subtle"
                >
                  <UiIcon name="grip-vertical" fest />
                </button>
                <div class="min-w-0 flex-1">
                  <NuxtLink
                    :to="`/materialien/${mat.materialId}`"
                    class="block truncate text-sm font-medium hover:text-primary"
                  >
                    {{ mat.title }}
                  </NuxtLink>
                  <p class="text-xs text-ink-subtle">
                    {{ materialTypes.label(mat.materialType as never) }}
                    · {{ materialUsages.label(mat.usage) }}
                  </p>
                </div>
                <UiButton
                  v-if="darfBearbeiten"
                  variante="still"
                  groesse="sm"
                  icon="xmark"
                  nur-icon
                  title="Entfernen"
                  @click="lessonMaterialEntfernen(mat.id)"
                />
              </div>
            </div>
          </UiCard>

          <UiCard v-if="data.series" titel="Reihe" icon="layer-group" einklappbar einklapp-id="stunde-reihe" :standard-offen="false">
            <NuxtLink :to="`/reihen/${data.series.id}`" class="text-sm font-medium hover:text-primary">
              {{ data.series.title }}
            </NuxtLink>
            <p v-if="data.positionInSeries" class="mt-1 text-xs text-ink-subtle">
              Stunde {{ data.positionInSeries }} in der Reihe
            </p>
          </UiCard>
        </aside>
      </div>
    </template>

    <MaterialAuswahlModal
      v-model="materialModal"
      :ausschliessen="(data?.materials ?? []).map((m) => m.materialId)"
      @ausgewaehlt="materialHinzufuegen"
    />

    <UiConfirm
      v-model="loeschenOffen"
      gefahr
      titel="Stunde löschen?"
      text="Der Verlaufsplan und alle Phasen werden entfernt. Zugeordnete Materialien bleiben erhalten."
      bestaetigen="Löschen"
      @bestaetigt="stundeLoeschen"
    />
  </div>
</template>
