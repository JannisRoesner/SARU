<script setup lang="ts">
withDefaults(
  defineProps<{
    titel?: string
    untertitel?: string
    icon?: string
    /** Ohne Innenabstand, wenn der Inhalt selbst welchen mitbringt (z. B. Tabellen). */
    blank?: boolean
    to?: string
  }>(),
  { blank: false },
)
</script>

<template>
  <component
    :is="to ? resolveComponent('NuxtLink') : 'section'"
    :to="to"
    class="karte flex flex-col overflow-hidden transition-shadow duration-200"
    :class="to && 'hover:shadow-[--shadow-raised] focus-visible:shadow-[--shadow-raised]'"
  >
    <header
      v-if="titel || $slots.kopf"
      class="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5"
    >
      <div class="min-w-0">
        <h2 v-if="titel" class="flex items-center gap-2 truncate font-semibold text-ink">
          <UiIcon v-if="icon" :name="icon" class="text-primary" />
          {{ titel }}
        </h2>
        <p v-if="untertitel" class="mt-0.5 truncate text-sm text-ink-muted">{{ untertitel }}</p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <slot name="kopf" />
      </div>
    </header>

    <div :class="blank ? 'flex-1' : 'flex-1 p-5'">
      <slot />
    </div>

    <footer v-if="$slots.fuss" class="border-t border-line bg-surface-sunken px-5 py-3">
      <slot name="fuss" />
    </footer>
  </component>
</template>
