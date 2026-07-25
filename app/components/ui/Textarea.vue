<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    placeholder?: string
    zeilen?: number
    disabled?: boolean
    fehlerhaft?: boolean
    /** Höhe automatisch an den Inhalt anpassen. */
    waechst?: boolean
  }>(),
  { zeilen: 3, waechst: true },
)

const wert = defineModel<string | null>()
const id = inject<string | undefined>('feld-id', undefined)
const feld = ref<HTMLTextAreaElement | null>(null)

function anpassen() {
  if (!props.waechst || !feld.value) return
  feld.value.style.height = 'auto'
  feld.value.style.height = `${feld.value.scrollHeight}px`
}

watch(wert, () => nextTick(anpassen))
onMounted(anpassen)
</script>

<template>
  <textarea
    :id="id"
    ref="feld"
    v-model="wert"
    :rows="zeilen"
    :placeholder="placeholder"
    :disabled="disabled"
    :aria-invalid="fehlerhaft || undefined"
    class="w-full resize-y rounded-lg border bg-surface px-3 py-2 text-sm leading-relaxed text-ink transition-colors placeholder:text-ink-subtle focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-sunken"
    :class="fehlerhaft ? 'border-danger' : 'border-line hover:border-line-strong'"
  />
</template>
