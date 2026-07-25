<script setup lang="ts">
import { seriesStatuses, materialTypes } from '#shared/utils/labels'
import type { SeriesDetail } from '~~/server/repositories/series.repository'
import type { LessonSummary } from '~~/server/repositories/lesson.repository'
import type { MaterialSummary } from '~~/server/repositories/material.repository'
import type { Paginated } from '#shared/types/domain'

const route = useRoute()
const id = computed(() => String(route.params.id))
const { darfBearbeiten } = useSitzung()
const { aufruf, laeuft } = useApi()
const { fachOptionen, lerngruppenOptionen, themenOptionen, schlagwortNamen } = useTaxonomie()

const { data, status, error, refresh } = await useFetch<SeriesDetail>(
  () => `/api/series/${id.value}`,
)

useHead({ title: () => data.value?.title ?? 'Reihe' })

const formular = reactive({
  title: '',
  description: null as string | null,
  subjectId: null as string | null,
  learningGroupId: null as string | null,
  topicId: null as string | null,
  startDate: null as string | null,
  endDate: null as string | null,
  schoolYear: null as string | null,
  status: 'planung',
  learningObjectives: [] as string[],
  notes: null as string | null,
  tagNames: [] as string[],
})

const geladen = ref(false)
const stundenBehaelter = ref<HTMLElement | null>(null)
const loeschenOffen = ref(false)
const stundeModal = ref(false)
const materialModal = ref(false)
const stundenSuche = ref('')

watch(
  data,
  (wert) => {
    if (!wert) return
    formular.title = wert.title
    formular.description = wert.description
    formular.subjectId = wert.subject?.id ?? null
    formular.learningGroupId = wert.learningGroup?.id ?? null
    formular.topicId = wert.topic?.id ?? null
    formular.startDate = wert.startDate
    formular.endDate = wert.endDate
    formular.schoolYear = wert.schoolYear
    formular.status = wert.status
    formular.learningObjectives = [...(wert.learningObjectives ?? [])]
    formular.notes = wert.notes
    formular.tagNames = wert.tags.map((t) => t.name)
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
    $fetch(`/api/series/${id.value}`, { method: 'PATCH', body: daten }),
})

useSortierbar(stundenBehaelter, {
  griff: '[data-griff="stunde"]',
  deaktiviert: computed(() => !darfBearbeiten.value),
  beiUmsortierung: async (ids) => {
    await aufruf(`/api/series/${id.value}/lessons/reorder`, {
      method: 'PATCH',
      body: { ids },
    })
    await refresh()
  },
})

const { data: freieStunden, refresh: freieLaden } = await useFetch<
  Paginated<LessonSummary>
>('/api/lessons', {
  query: computed(() => ({
    q: stundenSuche.value.trim() || undefined,
    withoutSeries: true,
    pageSize: 20,
    sort: 'datum_neu',
  })),
  immediate: false,
})

watch(stundeModal, (offen) => {
  if (offen) void freieLaden()
})

async function stundeZuordnen(lessonId: string) {
  const ok = await aufruf(`/api/series/${id.value}/lessons`, {
    method: 'POST',
    body: { lessonId },
    erfolgsmeldung: 'Stunde zugeordnet.',
  })
  if (ok) {
    stundeModal.value = false
    await refresh()
  }
}

async function stundeEntfernen(lessonId: string) {
  const ok = await aufruf(`/api/series/${id.value}/lessons/${lessonId}`, {
    method: 'DELETE',
    erfolgsmeldung: 'Stunde aus Reihe entfernt.',
  })
  if (ok !== null) await refresh()
}

async function materialHinzufuegen(material: MaterialSummary) {
  const ok = await aufruf(`/api/series/${id.value}/materials`, {
    method: 'POST',
    body: { materialId: material.id },
    erfolgsmeldung: 'Material hinzugefügt.',
  })
  if (ok) await refresh()
}

async function materialEntfernen(linkId: string) {
  const ok = await aufruf(`/api/series-materials/${linkId}`, {
    method: 'DELETE',
  })
  if (ok !== null) await refresh()
}

async function reiheLoeschen() {
  const ok = await aufruf(`/api/series/${id.value}`, {
    method: 'DELETE',
    erfolgsmeldung: 'Reihe gelöscht.',
  })
  loeschenOffen.value = false
  if (ok !== null) await navigateTo('/reihen')
}
</script>

<template>
  <div>
    <UiFehlerzustand v-if="error" :text="toApiFehler(error).nachricht" @erneut="refresh()" />
    <UiSkelett v-else-if="status === 'pending' || !data" art="list" :zeilen="8" />

    <template v-else>
      <div class="mb-2">
        <NuxtLink to="/reihen" class="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary">
          <UiIcon name="arrow-left" fest /> Reihen
        </NuxtLink>
      </div>

      <header class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="seitenkopf-kicker">Unterrichtsreihe</p>
          <h1 class="text-3xl tracking-tight text-ink">{{ data.title }}</h1>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <UiBadge :ton="seriesStatuses.tone(data.status)" :icon="seriesStatuses.icon(data.status)">
              {{ seriesStatuses.label(data.status) }}
            </UiBadge>
            <span v-if="data.subject" class="text-sm text-ink-muted">{{ data.subject.name }}</span>
            <span v-if="data.learningGroup" class="text-sm text-ink-muted">{{ data.learningGroup.name }}</span>
          </div>
          <div class="mt-3 max-w-md">
            <div class="mb-1 flex justify-between text-xs text-ink-muted">
              <span>{{ data.progress.durchgefuehrt }} / {{ data.progress.total }} durchgeführt</span>
              <span class="font-medium text-ink">{{ data.progress.percent }} %</span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
              <div
                class="h-full rounded-full bg-primary transition-[width] duration-500"
                :style="{ width: `${data.progress.percent}%` }"
              />
            </div>
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
            :to="`/reihen/${id}/drucken`"
            variante="sekundaer"
            icon="print"
          >
            Drucken
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

      <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div class="space-y-5">
          <UiCard titel="Angaben" icon="pen-to-square" einklappbar einklapp-id="reihe-angaben" :standard-offen="true">
            <div class="grid gap-4 sm:grid-cols-2">
              <UiField label="Titel" pflicht class="sm:col-span-2">
                <UiInput v-model="formular.title" :disabled="!darfBearbeiten" />
              </UiField>
              <UiEinklappbaresFeld
                v-model="formular.description"
                label="Beschreibung"
                :einklapp-id="`reihe-beschreibung-${id}`"
                class="sm:col-span-2"
                leer-vorschau="Keine Beschreibung"
                placeholder="Worum geht es in dieser Reihe …"
                :disabled="!darfBearbeiten"
              />
              <UiField label="Status">
                <UiSelect
                  v-model="formular.status"
                  :disabled="!darfBearbeiten"
                  :optionen="seriesStatuses.options().map((o) => ({ value: o.value, label: o.label }))"
                />
              </UiField>
              <UiField label="Schuljahr">
                <UiInput v-model="formular.schoolYear" :disabled="!darfBearbeiten" />
              </UiField>
              <UiField label="Beginn">
                <UiInput v-model="formular.startDate" type="date" :disabled="!darfBearbeiten" />
              </UiField>
              <UiField label="Ende">
                <UiInput v-model="formular.endDate" type="date" :disabled="!darfBearbeiten" />
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
              <UiField label="Lernziele" class="sm:col-span-2">
                <UiTagInput v-model="formular.learningObjectives" :disabled="!darfBearbeiten" />
              </UiField>
              <UiField label="Schlagwörter" class="sm:col-span-2">
                <UiTagInput v-model="formular.tagNames" :vorschlaege="schlagwortNamen" :disabled="!darfBearbeiten" />
              </UiField>
              <UiEinklappbaresFeld
                v-model="formular.notes"
                label="Notizen"
                :einklapp-id="`reihe-notizen-${id}`"
                class="sm:col-span-2"
                leer-vorschau="Keine Notizen"
                placeholder="Interne Notizen zur Reihe …"
                :disabled="!darfBearbeiten"
              />
            </div>
          </UiCard>

          <UiCard titel="Stundenverlauf" icon="timeline" einklappbar einklapp-id="reihe-stundenverlauf" :standard-offen="false">
            <template #kopf>
              <UiButton
                v-if="darfBearbeiten"
                variante="sekundaer"
                groesse="sm"
                icon="plus"
                @click="stundeModal = true"
              >
                Stunde zuordnen
              </UiButton>
            </template>

            <UiLeerzustand
              v-if="!data.lessons.length"
              klein
              icon="chalkboard-user"
              titel="Noch keine Stunden"
              text="Ordne bestehende Stunden zu oder lege neue an und verknüpfe sie hier."
            />

            <div ref="stundenBehaelter" class="space-y-2">
              <div
                v-for="(stunde, index) in data.lessons"
                :key="stunde.id"
                :data-id="stunde.id"
                class="flex items-stretch gap-2"
              >
                <div class="flex w-8 flex-col items-center pt-4">
                  <span class="text-xs font-semibold text-ink-subtle">{{ index + 1 }}</span>
                  <div
                    v-if="index < data.lessons.length - 1"
                    class="mt-1 w-px flex-1 bg-line"
                  />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-start gap-1">
                    <button
                      v-if="darfBearbeiten"
                      type="button"
                      data-griff="stunde"
                      class="mt-4 cursor-grab px-1 text-ink-subtle"
                      title="Ziehen zum Sortieren"
                    >
                      <UiIcon name="grip-vertical" fest />
                    </button>
                    <div class="min-w-0 flex-1">
                      <StundeKarte :stunde="stunde" ohne-reihe kompakt />
                    </div>
                    <UiButton
                      v-if="darfBearbeiten"
                      variante="still"
                      groesse="sm"
                      icon="xmark"
                      nur-icon
                      title="Aus Reihe entfernen"
                      class="mt-3"
                      @click="stundeEntfernen(stunde.id)"
                    />
                  </div>
                </div>
              </div>
            </div>
          </UiCard>
        </div>

        <aside class="space-y-4">
          <UiCard titel="Reihenmaterialien" icon="folder-open" einklappbar einklapp-id="reihe-materialien" :standard-offen="false">
            <template #kopf>
              <UiButton
                v-if="darfBearbeiten"
                variante="sekundaer"
                groesse="sm"
                icon="plus"
                nur-icon
                title="Hinzufügen"
                @click="materialModal = true"
              />
            </template>
            <UiLeerzustand
              v-if="!data.materials.length"
              klein
              icon="folder-open"
              titel="Keine Materialien"
              text="Ordne übergreifende Materialien der Reihe zu."
            />
            <ul v-else class="space-y-1.5">
              <li
                v-for="mat in data.materials"
                :key="mat.id"
                class="flex items-center gap-2 rounded-lg border border-line px-2 py-2 text-sm"
              >
                <NuxtLink
                  :to="`/materialien/${mat.materialId}`"
                  class="min-w-0 flex-1 truncate font-medium hover:text-primary"
                >
                  {{ mat.title }}
                </NuxtLink>
                <span class="text-xs text-ink-subtle">
                  {{ materialTypes.label(mat.materialType as never) }}
                </span>
                <UiButton
                  v-if="darfBearbeiten"
                  variante="still"
                  groesse="sm"
                  icon="xmark"
                  nur-icon
                  title="Entfernen"
                  @click="materialEntfernen(mat.id)"
                />
              </li>
            </ul>
          </UiCard>
        </aside>
      </div>
    </template>

    <UiModal v-model="stundeModal" titel="Stunde zuordnen" icon="chalkboard-user" breite="lg">
      <UiField label="Suche">
        <UiInput v-model="stundenSuche" icon="magnifying-glass" placeholder="Freie Stunden ohne Reihe …" />
      </UiField>
      <div class="mt-4 max-h-[50vh] space-y-2 overflow-y-auto">
        <UiLeerzustand
          v-if="!(freieStunden?.items.length)"
          klein
          icon="calendar-xmark"
          titel="Keine freien Stunden"
          text="Alle Stunden sind bereits einer Reihe zugeordnet, oder es gibt noch keine."
        >
          <UiButton to="/stunden/neu" variante="sekundaer" icon="plus">Stunde anlegen</UiButton>
        </UiLeerzustand>
        <button
          v-for="stunde in freieStunden?.items ?? []"
          :key="stunde.id"
          type="button"
          class="karte karte-klickbar flex w-full gap-3 p-3 text-left"
          @click="stundeZuordnen(stunde.id)"
        >
          <span class="font-medium text-ink">{{ stunde.title }}</span>
          <span class="ml-auto text-xs text-ink-subtle">
            {{ stunde.date ? formatDatum(stunde.date) : 'Ohne Datum' }}
          </span>
        </button>
      </div>
      <template #aktionen>
        <UiButton variante="sekundaer" @click="stundeModal = false">Schließen</UiButton>
      </template>
    </UiModal>

    <MaterialAuswahlModal
      v-model="materialModal"
      :ausschliessen="(data?.materials ?? []).map((m) => m.materialId)"
      @ausgewaehlt="materialHinzufuegen"
    />

    <UiConfirm
      v-model="loeschenOffen"
      gefahr
      titel="Reihe löschen?"
      text="Die Reihe wird entfernt. Zugeordnete Stunden bleiben erhalten, verlieren aber die Reihenzuordnung."
      bestaetigen="Löschen"
      @bestaetigt="reiheLoeschen"
    />
  </div>
</template>
