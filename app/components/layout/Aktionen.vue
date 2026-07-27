<script setup lang="ts">
/**
 * Aktionsleiste für Seitenköpfe und Detail-Header.
 * Auf schmalen Viewports volle Breite und Umbruch, damit Buttons nicht
 * die Seite horizontal aufblasen.
 */
withDefaults(
  defineProps<{
    /** Auf Mobile Buttons untereinander statt nebeneinander. */
    stapeln?: boolean
  }>(),
  { stapeln: false },
)
</script>

<template>
  <div
    class="aktionen-leiste flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto"
    :class="stapeln ? 'flex-col items-stretch sm:flex-row sm:items-center' : ''"
  >
    <slot />
  </div>
</template>
