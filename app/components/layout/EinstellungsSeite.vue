<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Ohne Spaltenbegrenzung, z. B. das Einstellungsmenü wie Import. */
    volleBreite?: boolean
  }>(),
  { volleBreite: false },
)
</script>

<template>
  <div class="w-full space-y-5" :class="volleBreite ? '' : 'mx-auto max-w-3xl'">
    <slot />
  </div>
</template>
