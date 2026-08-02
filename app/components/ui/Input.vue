<script setup lang="ts">
defineOptions({ inheritAttrs: false })

withDefaults(
  defineProps<{
    type?: string
    placeholder?: string
    icon?: string
    disabled?: boolean
    fehlerhaft?: boolean
    min?: string | number
    max?: string | number
    step?: string | number
  }>(),
  {
    type: 'text',
    placeholder: undefined,
    icon: undefined,
    min: undefined,
    max: undefined,
    step: undefined,
  },
)

const attrs = useAttrs()
const wert = defineModel<string | number | null>()
const id = inject<string | undefined>('feld-id', undefined)
</script>

<template>
  <div class="relative">
    <UiIcon
      v-if="icon"
      :name="icon"
      class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-subtle"
    />
    <input
      :id="id"
      v-model="wert"
      v-bind="attrs"
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      :min="min"
      :max="max"
      :step="step"
      :aria-invalid="fehlerhaft || undefined"
      class="h-10 w-full rounded-lg border bg-surface px-3 text-sm text-ink transition-colors placeholder:text-ink-subtle focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-subtle"
      :class="[fehlerhaft ? 'border-danger' : 'border-line hover:border-line-strong', icon && 'pl-9']"
    >
  </div>
</template>
