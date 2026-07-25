<script setup lang="ts">
defineProps<{ text?: string | null }>()
defineEmits<{ erneut: [] }>()
</script>

<template>
  <div class="karte flex flex-col items-center gap-3 border-danger/30 bg-danger-soft/40 py-10 text-center">
    <UiIcon name="triangle-exclamation" class="text-2xl text-danger" />
    <div>
      <p class="font-medium text-ink">Das hat leider nicht geklappt</p>
      <p class="mx-auto mt-1 max-w-md text-sm text-ink-muted">
        {{ text || 'Die Daten konnten nicht geladen werden.' }}
      </p>
    </div>
    <UiButton icon="rotate-right" groesse="sm" @click="$emit('erneut')">Erneut versuchen</UiButton>
  </div>
</template>
