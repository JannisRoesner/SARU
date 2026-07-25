<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    variante?: 'primaer' | 'sekundaer' | 'still' | 'gefahr' | 'akzent'
    groesse?: 'sm' | 'md' | 'lg'
    icon?: string
    iconRechts?: string
    laedt?: boolean
    disabled?: boolean
    /** Nur Icon, ohne Beschriftung – benötigt `title` für die Barrierefreiheit. */
    nurIcon?: boolean
    breit?: boolean
    to?: string
    type?: 'button' | 'submit' | 'reset'
  }>(),
  { variante: 'sekundaer', groesse: 'md', type: 'button' },
)

const VARIANTEN = {
  primaer:
    'bg-primary text-primary-contrast hover:bg-primary-strong shadow-sm disabled:hover:bg-primary',
  akzent: 'bg-accent text-accent-contrast hover:bg-accent-strong shadow-sm',
  sekundaer: 'bg-surface text-ink border border-line hover:bg-surface-hover hover:border-line-strong',
  still: 'text-ink-muted hover:bg-surface-hover hover:text-ink',
  gefahr: 'bg-danger text-white hover:brightness-110 shadow-sm',
} as const

const GROESSEN = { sm: 'h-8 text-sm gap-1.5', md: 'h-10 text-sm gap-2', lg: 'h-12 text-base gap-2.5' } as const
const PADDING = { sm: 'px-3', md: 'px-4', lg: 'px-5' } as const
const NUR_ICON = { sm: 'w-8', md: 'w-10', lg: 'w-12' } as const

const klassen = computed(() => [
  'inline-flex items-center justify-center rounded-lg font-medium transition-all duration-150',
  'disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]',
  VARIANTEN[props.variante],
  GROESSEN[props.groesse],
  props.nurIcon ? NUR_ICON[props.groesse] : PADDING[props.groesse],
  props.breit && 'w-full',
])

const gesperrt = computed(() => props.disabled || props.laedt)
</script>

<template>
  <component
    :is="to ? resolveComponent('NuxtLink') : 'button'"
    :to="to"
    :type="to ? undefined : type"
    :disabled="to ? undefined : gesperrt"
    :aria-disabled="to && gesperrt ? 'true' : undefined"
    :aria-busy="laedt ? 'true' : undefined"
    :class="klassen"
  >
    <UiIcon v-if="laedt" name="circle-notch" dreht fest />
    <UiIcon v-else-if="icon" :name="icon" fest />
    <slot v-if="!nurIcon" />
    <UiIcon v-if="iconRechts && !laedt" :name="iconRechts" fest />
  </component>
</template>
