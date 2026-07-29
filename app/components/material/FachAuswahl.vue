<script setup lang="ts">
withDefaults(
  defineProps<{
    disabled?: boolean
    platzhalter?: string
  }>(),
  { platzhalter: 'Fach eingeben …' },
)

const werte = defineModel<string[]>({ default: () => [] })
const { fachNamen } = useTaxonomie()
</script>

<template>
  <UiTagInput
    v-model="werte"
    :vorschlaege="fachNamen"
    :disabled="disabled"
    :platzhalter="platzhalter"
    :max="16"
  />
</template>
