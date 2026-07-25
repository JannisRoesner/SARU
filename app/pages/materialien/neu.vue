<script setup lang="ts">
import { materialTypes, schoolForms } from '#shared/utils/labels'
import type { MaterialDetail } from '~~/server/repositories/material.repository'

definePageMeta({ middleware: [] })
useHead({ title: 'Material anlegen' })

const { darfBearbeiten } = useSitzung()
const { aufruf, laeuft } = useApi()
const { fachOptionen, lerngruppenOptionen, themenOptionen, schlagwortNamen } = useTaxonomie()

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
  gradeLevels: [] as number[],
  tagNames: [] as string[],
  learningObjectives: [] as string[],
  source: '',
  author: '',
})

const jahre = Array.from({ length: 13 }, (_, i) => ({
  value: String(i + 1),
  label: `${i + 1}. Klasse`,
}))
const gewaehlteJahre = ref<string[]>([])

watch(gewaehlteJahre, (werte) => {
  formular.gradeLevels = werte.map(Number).filter((n) => n >= 1 && n <= 13)
})

async function anlegen() {
  const ergebnis = await aufruf<MaterialDetail>('/api/materials', {
    method: 'POST',
    body: {
      ...formular,
      description: formular.description || null,
      schoolForm: formular.schoolForm || null,
      source: formular.source || null,
      author: formular.author || null,
    },
    erfolgsmeldung: 'Material angelegt.',
  })
  if (ergebnis) await navigateTo(`/materialien/${ergebnis.id}`)
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <LayoutSeitenkopf
      kicker="Neu"
      titel="Material anlegen"
      untertitel="Titel und Typ reichen für den Anfang – Dateien und Varianten ergänzt du danach."
    >
      <template #aktionen>
        <UiButton to="/materialien" variante="still" icon="arrow-left">Zurück</UiButton>
      </template>
    </LayoutSeitenkopf>

    <form class="space-y-5" @submit.prevent="anlegen">
      <UiCard titel="Grundangaben" icon="file-lines">
        <div class="space-y-4">
          <UiField label="Titel" pflicht>
            <UiInput v-model="formular.title" placeholder="z. B. AB 1 – Photosynthese" />
          </UiField>
          <UiField label="Kurzbeschreibung">
            <UiTextarea v-model="formular.description" :zeilen="3" placeholder="Worum geht es?" />
          </UiField>
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
                :optionen="schoolForms.options().map((o) => ({ value: o.value, label: o.label }))"
              />
            </UiField>
          </div>
        </div>
      </UiCard>

      <UiCard titel="Einordnung" icon="sitemap">
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
            <select
              v-model="gewaehlteJahre"
              multiple
              class="min-h-28 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            >
              <option v-for="j in jahre" :key="j.value" :value="j.value">{{ j.label }}</option>
            </select>
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
          Anlegen
        </UiButton>
      </div>
    </form>
  </div>
</template>
