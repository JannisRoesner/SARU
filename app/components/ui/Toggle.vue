<script setup lang="ts">
defineProps<{ label?: string; hinweis?: string; disabled?: boolean }>()

const an = defineModel<boolean>({ required: true })
</script>

<template>
  <label
    class="flex cursor-pointer items-start gap-3"
    :class="disabled && 'cursor-not-allowed opacity-60'"
  >
    <button
      type="button"
      role="switch"
      :aria-checked="an"
      :disabled="disabled"
      class="relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:cursor-not-allowed"
      :class="an ? 'bg-primary-solid' : 'bg-line-strong'"
      @click="an = !an"
    >
      <span
        class="absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
        :class="an && 'translate-x-5'"
      />
    </button>

    <span v-if="label || hinweis" class="min-w-0">
      <span v-if="label" class="block text-sm font-medium text-ink">{{ label }}</span>
      <span v-if="hinweis" class="mt-0.5 block text-xs text-ink-muted">{{ hinweis }}</span>
    </span>
  </label>
</template>
