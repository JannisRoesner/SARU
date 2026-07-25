<script setup lang="ts">
/** Dünne Hülle um FontAwesome, damit Aufrufe kurz bleiben: `<UiIcon name="save" />`. */
const props = withDefaults(
  defineProps<{
    name: string
    /** `fas` (gefüllt) oder `far` (Umriss). */
    stil?: 'fas' | 'far'
    fest?: boolean
    dreht?: boolean
  }>(),
  { stil: 'fas', fest: false, dreht: false },
)

const icon = computed(() => [props.stil, props.name])
</script>

<template>
  <FontAwesomeIcon
    :icon="icon"
    :fixed-width="fest"
    :spin="dreht"
    aria-hidden="true"
  />
</template>
