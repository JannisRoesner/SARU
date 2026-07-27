<script setup lang="ts">
defineProps<{
  titel: string
  untertitel?: string
  kicker?: string
  zurueckTo?: string
  zurueckLabel?: string
}>()
</script>

<template>
  <div>
    <div v-if="zurueckTo && zurueckLabel" class="mb-2">
      <NuxtLink
        :to="zurueckTo"
        class="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary"
      >
        <UiIcon name="arrow-left" fest /> {{ zurueckLabel }}
      </NuxtLink>
    </div>

    <header
      class="seitenkopf flex flex-col gap-4 !max-w-none sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-x-4 sm:gap-y-3"
    >
      <div class="min-w-0 max-w-3xl">
        <p v-if="kicker" class="seitenkopf-kicker">{{ kicker }}</p>
        <h1 class="break-words text-3xl tracking-tight text-ink sm:text-[2rem]">{{ titel }}</h1>
        <p v-if="untertitel" class="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
          {{ untertitel }}
        </p>
      </div>
      <LayoutAktionen v-if="$slots.aktionen" class="sm:ml-auto" stapeln>
        <slot name="aktionen" />
      </LayoutAktionen>
    </header>
  </div>
</template>
