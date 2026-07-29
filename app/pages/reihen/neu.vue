<script setup lang="ts">
import { seriesStatuses } from '#shared/utils/labels'
import type { SeriesDetail } from '~~/server/repositories/series.repository'

useHead({ title: 'Reihe starten' })

const { darfBearbeiten } = useSitzung()
const { aufruf, laeuft } = useApi()
const { lerngruppenOptionen, themenOptionen } = useTaxonomie()

if (!darfBearbeiten.value) await navigateTo('/reihen')

const formular = reactive({
  title: '',
  description: '',
  subjectId: null as string | null,
  subjectName: '',
  learningGroupId: null as string | null,
  topicId: null as string | null,
  startDate: null as string | null,
  endDate: null as string | null,
  schoolYear: '',
  status: 'planung' as string,
  learningObjectives: [] as string[],
})

async function anlegen() {
  const ergebnis = await aufruf<SeriesDetail>('/api/series', {
    method: 'POST',
    body: {
      ...formular,
      description: formular.description || null,
      schoolYear: formular.schoolYear || null,
      startDate: formular.startDate || null,
      endDate: formular.endDate || null,
    },
    erfolgsmeldung: 'Reihe angelegt.',
  })
  if (ergebnis) await navigateTo(`/reihen/${ergebnis.id}`)
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <LayoutSeitenkopf
      zurueck-to="/reihen"
      zurueck-label="Alle Reihen"
      kicker="Reihen"
      titel="Reihe starten"
      untertitel="Bündele zusammengehörige Stunden zu einer Unterrichtsreihe."
    />

    <form class="space-y-5" @submit.prevent="anlegen">
      <UiCard titel="Rahmen" icon="layer-group" einklappbar einklapp-id="reihe-neu-rahmen">
        <div class="space-y-4">
          <UiField label="Titel" pflicht>
            <UiInput v-model="formular.title" placeholder="z. B. Evolution – 9b" />
          </UiField>
          <UiEinklappbaresFeld
            v-model="formular.description"
            label="Beschreibung"
            einklapp-id="reihe-neu-beschreibung"
            leer-vorschau="Keine Beschreibung"
            placeholder="Worum geht es in dieser Reihe …"
            immer-offen
          />
          <div class="grid gap-4 sm:grid-cols-2">
            <UiField label="Status">
              <UiSelect
                v-model="formular.status"
                :optionen="seriesStatuses.options().map((o) => ({ value: o.value, label: o.label }))"
              />
            </UiField>
            <UiField label="Schuljahr">
              <UiInput v-model="formular.schoolYear" placeholder="2025/26" />
            </UiField>
            <UiField label="Beginn">
              <UiInput v-model="formular.startDate" type="date" />
            </UiField>
            <UiField label="Ende">
              <UiInput v-model="formular.endDate" type="date" />
            </UiField>
            <UiFachFeld
              v-model:subject-id="formular.subjectId"
              v-model:subject-name="formular.subjectName"
              class="sm:col-span-2"
            />
            <UiField label="Lerngruppe">
              <UiSelect
                v-model="formular.learningGroupId"
                platzhalter="–"
                :optionen="lerngruppenOptionen"
              />
            </UiField>
          </div>
          <UiField label="Thema">
            <UiSelect v-model="formular.topicId" platzhalter="–" :optionen="themenOptionen" />
          </UiField>
        </div>
      </UiCard>

      <div class="flex justify-end gap-2">
        <UiButton to="/reihen" variante="sekundaer">Abbrechen</UiButton>
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
    </form>
  </div>
</template>
