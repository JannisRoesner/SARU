<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    placeholder?: string
    zeilen?: number
    disabled?: boolean
    fehlerhaft?: boolean
    /** Höhe automatisch an den Inhalt anpassen. */
    waechst?: boolean
    /** Feste Maximalhöhe mit internem Scroll statt Seitenwachstum. */
    begrenzt?: boolean
  }>(),
  { placeholder: undefined, zeilen: 3, waechst: true, begrenzt: false },
)

const waechstAktiv = computed(() => props.waechst && !props.begrenzt)

const wert = defineModel<string | null>()
const id = inject<string | undefined>('feld-id', undefined)
const feld = ref<HTMLTextAreaElement | null>(null)

function anpassen() {
  if (!waechstAktiv.value || !feld.value) return
  feld.value.style.height = 'auto'
  feld.value.style.height = `${feld.value.scrollHeight}px`
}

watch(wert, () => nextTick(anpassen))
watch(waechstAktiv, () => nextTick(anpassen))
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
    class="w-full rounded-lg border bg-surface px-3 py-2 text-sm leading-relaxed text-ink transition-colors placeholder:text-ink-subtle focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-sunken"
    :class="[
      fehlerhaft ? 'border-danger' : 'border-line hover:border-line-strong',
      begrenzt ? 'max-h-[min(24rem,50vh)] overflow-y-auto resize-y' : 'resize-y',
    ]"
  />
</template>
