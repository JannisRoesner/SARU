<script setup lang="ts">
withDefaults(
  defineProps<{
    icon?: string
    titel: string
    text?: string
    /** Kompakt für Bereiche innerhalb einer Karte. */
    klein?: boolean
  }>(),
  { icon: 'inbox', text: undefined, klein: false },
)
</script>

<template>
  <div class="flex flex-col items-center justify-center text-center" :class="klein ? 'gap-2 py-4' : 'gap-3 py-16'">
    <div
      class="flex items-center justify-center rounded-full bg-surface-sunken text-ink-subtle"
      :class="klein ? 'size-11 text-lg' : 'size-16 text-2xl'"
    >
      <UiIcon :name="icon" />
    </div>
    <div>
      <p class="font-medium text-ink" :class="!klein && 'text-lg'">{{ titel }}</p>
      <p v-if="text" class="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-muted">{{ text }}</p>
    </div>
    <div v-if="$slots.default" class="mt-1 flex flex-wrap justify-center gap-2">
      <slot />
    </div>
  </div>
</template>
