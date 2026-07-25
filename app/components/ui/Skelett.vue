<script setup lang="ts">
withDefaults(defineProps<{ zeilen?: number; art?: 'liste' | 'karten' | 'text' }>(), {
  zeilen: 4,
  art: 'liste',
})
</script>

<template>
  <div :aria-busy="true" aria-live="polite" class="animate-pulse">
    <span class="sr-only">Inhalte werden geladen …</span>

    <div v-if="art === 'karten'" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="i in zeilen" :key="i" class="karte space-y-3 p-5">
        <div class="h-4 w-2/3 rounded bg-surface-sunken" />
        <div class="h-3 w-full rounded bg-surface-sunken" />
        <div class="h-3 w-4/5 rounded bg-surface-sunken" />
        <div class="flex gap-2 pt-1">
          <div class="h-5 w-16 rounded bg-surface-sunken" />
          <div class="h-5 w-20 rounded bg-surface-sunken" />
        </div>
      </div>
    </div>

    <div v-else-if="art === 'text'" class="space-y-2">
      <div v-for="i in zeilen" :key="i" class="h-3 rounded bg-surface-sunken" :style="{ width: `${95 - i * 7}%` }" />
    </div>

    <div v-else class="space-y-2">
      <div v-for="i in zeilen" :key="i" class="karte flex items-center gap-4 p-4">
        <div class="size-10 shrink-0 rounded-lg bg-surface-sunken" />
        <div class="flex-1 space-y-2">
          <div class="h-3.5 w-1/3 rounded bg-surface-sunken" />
          <div class="h-3 w-2/3 rounded bg-surface-sunken" />
        </div>
      </div>
    </div>
  </div>
</template>
