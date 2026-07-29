<script setup lang="ts">
withDefaults(
  defineProps<{
    disabled?: boolean
    /** Nur Freitext – ohne Auswahl aus dem Bestand. */
    nurFreitext?: boolean
  }>(),
  { nurFreitext: false },
)

const subjectId = defineModel<string | null>('subjectId', { default: null })
const subjectName = defineModel<string>('subjectName', { default: '' })

const { fachOptionen } = useTaxonomie()

watch(subjectId, (id) => {
  if (id) subjectName.value = ''
})

watch(subjectName, (name) => {
  if (name.trim()) subjectId.value = null
})
</script>

<template>
  <div :class="nurFreitext ? '' : 'grid gap-4 sm:grid-cols-2'">
    <UiField v-if="!nurFreitext" label="Fach (bestehend)">
      <UiSelect
        v-model="subjectId"
        platzhalter="Neu anlegen …"
        :optionen="fachOptionen"
        :disabled="disabled || Boolean(subjectName.trim())"
      />
    </UiField>
    <UiField :label="nurFreitext ? 'Fach' : 'Fachname (neu)'">
      <UiInput
        v-model="subjectName"
        placeholder="z. B. Informatik"
        :disabled="disabled || Boolean(subjectId)"
      />
    </UiField>
  </div>
</template>
