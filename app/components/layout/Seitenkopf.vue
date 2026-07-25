<script setup lang="ts">
defineProps<{
  titel: string
  untertitel?: string
  kicker?: string
}>()
</script>

<template>
  <header class="seitenkopf flex flex-wrap items-start justify-between gap-x-4 gap-y-3 !max-w-none">
    <div class="min-w-0 max-w-3xl">
      <p v-if="kicker" class="seitenkopf-kicker">{{ kicker }}</p>
      <h1 class="text-3xl tracking-tight text-ink sm:text-[2rem]">{{ titel }}</h1>
      <p v-if="untertitel" class="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
        {{ untertitel }}
      </p>
    </div>
    <div v-if="$slots.aktionen" class="ml-auto flex shrink-0 flex-wrap items-center gap-2">
      <slot name="aktionen" />
    </div>
  </header>
</template>
