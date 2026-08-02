<script setup lang="ts">
import { parseSearchSnippet } from '#shared/utils/search-snippet'

const props = defineProps<{
  text: string
}>()

const teile = computed(() => parseSearchSnippet(props.text))
</script>

<template>
  <span>
    <template v-for="(teil, index) in teile" :key="index">
      <mark v-if="teil.highlighted">{{ teil.text }}</mark>
      <template v-else>{{ teil.text }}</template>
    </template>
  </span>
</template>
