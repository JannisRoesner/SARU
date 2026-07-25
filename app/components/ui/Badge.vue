<script setup lang="ts">
import type { LabelDefinition } from '#shared/utils/labels'

const props = withDefaults(
  defineProps<{
    ton?: NonNullable<LabelDefinition['tone']>
    icon?: string
    groesse?: 'sm' | 'md'
    /** Eigene Farbe, z. B. die Fachfarbe aus der Datenbank. */
    farbe?: string | null
  }>(),
  { ton: 'neutral', groesse: 'sm' },
)

const TOENE = {
  neutral: 'bg-surface-sunken text-ink-muted border-line',
  primary: 'bg-primary-soft text-primary-strong border-transparent',
  accent: 'bg-accent-soft text-accent-strong border-transparent',
  gruen: 'bg-success-soft text-success-strong border-transparent',
  gelb: 'bg-warning-soft text-warning-strong border-transparent',
  rot: 'bg-danger-soft text-danger-strong border-transparent',
  violett: 'bg-violett-soft text-violett-strong border-transparent',
  ki: 'bg-ki-soft text-ki-strong border-transparent',
} as const

const eigeneFarbe = computed(() =>
  props.farbe
    ? {
        // Die Fachfarbe bleibt in beiden Modi lesbar, indem sie mit der Fläche gemischt wird.
        backgroundColor: `color-mix(in oklab, ${props.farbe} 18%, var(--surface-base))`,
        color: `color-mix(in oklab, ${props.farbe} 80%, var(--text-strong))`,
        borderColor: 'transparent',
      }
    : undefined,
)
</script>

<template>
  <span
    class="inline-flex max-w-full items-center gap-1 rounded-md border font-medium whitespace-nowrap"
    :class="[
      groesse === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-sm',
      farbe ? '' : TOENE[ton],
    ]"
    :style="eigeneFarbe"
  >
    <UiIcon v-if="icon" :name="icon" class="shrink-0 text-[0.85em]" />
    <span class="truncate"><slot /></span>
  </span>
</template>
