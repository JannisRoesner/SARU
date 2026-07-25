<script setup lang="ts">
export interface Auswahl {
  value: string | number | null
  label: string
  icon?: string
}

withDefaults(
  defineProps<{
    optionen: Auswahl[]
    platzhalter?: string
    disabled?: boolean
    fehlerhaft?: boolean
  }>(),
  {},
)

const wert = defineModel<string | number | null>()
const id = inject<string | undefined>('feld-id', undefined)
</script>

<template>
  <div class="relative">
    <select
      :id="id"
      v-model="wert"
      :disabled="disabled"
      :aria-invalid="fehlerhaft || undefined"
      class="h-10 w-full appearance-none rounded-lg border bg-surface pr-9 pl-3 text-sm text-ink transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-sunken"
      :class="fehlerhaft ? 'border-danger' : 'border-line hover:border-line-strong'"
    >
      <option v-if="platzhalter" :value="null">{{ platzhalter }}</option>
      <option v-for="option in optionen" :key="String(option.value)" :value="option.value">
        {{ option.label }}
      </option>
    </select>
    <UiIcon
      name="chevron-down"
      class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-subtle"
    />
  </div>
</template>
