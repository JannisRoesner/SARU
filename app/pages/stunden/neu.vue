<script setup lang="ts">
import { lessonStatuses } from '#shared/utils/labels'
import type { LessonDetail } from '~~/server/repositories/lesson.repository'

useHead({ title: 'Stunde planen' })

const { darfBearbeiten } = useSitzung()
const { aufruf, laeuft } = useApi()
const { fachOptionen, lerngruppenOptionen, themenOptionen } = useTaxonomie()

if (!darfBearbeiten.value) await navigateTo('/stunden')

const formular = reactive({
  title: '',
  date: null as string | null,
  scheduleNote: '',
  periodFrom: null as number | null,
  periodTo: null as number | null,
  durationMinutes: 45 as number | null,
  subjectId: null as string | null,
  learningGroupId: null as string | null,
  topicId: null as string | null,
  status: 'entwurf' as string,
  learningObjectives: [] as string[],
  methodSummary: '',
  homework: '',
})

async function anlegen() {
  const ergebnis = await aufruf<LessonDetail>('/api/lessons', {
    method: 'POST',
    body: {
      ...formular,
      scheduleNote: formular.scheduleNote || null,
      methodSummary: formular.methodSummary || null,
      homework: formular.homework || null,
      date: formular.date || null,
    },
    erfolgsmeldung: 'Stunde angelegt.',
  })
  if (ergebnis) await navigateTo(`/stunden/${ergebnis.id}`)
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <LayoutSeitenkopf
      kicker="Neu"
      titel="Stunde planen"
      untertitel="Lege den Rahmen fest – Phasen und Materialien ergänzt du im Editor."
    >
      <template #aktionen>
        <UiButton to="/stunden" variante="still" icon="arrow-left">Zurück</UiButton>
      </template>
    </LayoutSeitenkopf>

    <form class="space-y-5" @submit.prevent="anlegen">
      <UiCard titel="Rahmen" icon="chalkboard-user">
        <div class="space-y-4">
          <UiField label="Titel" pflicht>
            <UiInput v-model="formular.title" placeholder="z. B. Einstieg Photosynthese" />
          </UiField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UiField label="Datum">
              <UiInput v-model="formular.date" type="date" />
            </UiField>
            <UiField label="Status">
              <UiSelect
                v-model="formular.status"
                :optionen="lessonStatuses.options().map((o) => ({ value: o.value, label: o.label }))"
              />
            </UiField>
            <UiField label="Von Stunde">
              <UiInput v-model="formular.periodFrom" type="number" min="1" max="12" />
            </UiField>
            <UiField label="Bis Stunde">
              <UiInput v-model="formular.periodTo" type="number" min="1" max="12" />
            </UiField>
            <UiField label="Fach">
              <UiSelect v-model="formular.subjectId" platzhalter="–" :optionen="fachOptionen" />
            </UiField>
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
        <UiButton to="/stunden" variante="sekundaer">Abbrechen</UiButton>
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
