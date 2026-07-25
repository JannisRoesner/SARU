<script setup lang="ts">
defineProps<{
  label?: string
  hinweis?: string
  fehler?: string | string[] | null
  pflicht?: boolean
  /** Feld über die volle Breite eines Rasters ziehen. */
  breit?: boolean
}>()

const id = useId()
provide('feld-id', id)
</script>

<template>
  <div :class="breit && 'sm:col-span-2'">
    <label v-if="label" :for="id" class="mb-1.5 flex items-center gap-1 text-sm font-medium text-ink">
      {{ label }}
      <span v-if="pflicht" class="text-danger" aria-hidden="true">*</span>
    </label>

    <slot :id="id" />

    <p v-if="hinweis && !fehler" class="mt-1.5 text-xs text-ink-subtle">{{ hinweis }}</p>
    <p v-if="fehler" class="mt-1.5 flex items-start gap-1.5 text-xs text-danger">
      <UiIcon name="circle-exclamation" class="mt-0.5 shrink-0" />
      <span>{{ Array.isArray(fehler) ? fehler.join(' ') : fehler }}</span>
    </p>
  </div>
</template>
