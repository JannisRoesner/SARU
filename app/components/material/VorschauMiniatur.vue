<script setup lang="ts">
/**
 * Papierähnliche Dokument-Miniatur (paperless-Stil).
 * Lädt `/api/assets/:id/thumbnail`; bei Fehler oder fehlender Datei Icon-Platzhalter.
 */
const props = withDefaults(
  defineProps<{
    assetId?: string | null
    fileName?: string | null
    mimeType?: string | null
    /** Kompakte Kachel in Listen. */
    groesse?: 'sm' | 'md' | 'lg'
    klickbar?: boolean
  }>(),
  { groesse: 'md', klickbar: false },
)

const emit = defineEmits<{ klick: [] }>()

const geladen = ref(false)
const fehler = ref(false)

const hatMiniatur = computed(() => {
  if (!props.assetId) return false
  const mime = props.mimeType ?? ''
  const name = (props.fileName ?? '').toLowerCase()
  return (
    mime === 'application/pdf' ||
    name.endsWith('.pdf') ||
    (mime.startsWith('image/') && mime !== 'image/svg+xml')
  )
})

const src = computed(() =>
  hatMiniatur.value && props.assetId ? `/api/assets/${props.assetId}/thumbnail` : null,
)

const icon = computed(() => dateiIcon(props.fileName))

const mass = computed(() => {
  if (props.groesse === 'sm') return 'h-14 w-11'
  if (props.groesse === 'lg') return 'h-40 w-28'
  return 'h-24 w-[4.5rem]'
})

watch(src, () => {
  geladen.value = false
  fehler.value = false
})
</script>

<template>
  <component
    :is="klickbar ? 'button' : 'div'"
    type="button"
    class="vorschau-miniatur relative shrink-0 overflow-hidden rounded-md border border-line bg-surface-sunken shadow-sm"
    :class="[
      mass,
      klickbar && 'cursor-pointer transition hover:border-primary hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
    ]"
    :title="klickbar ? 'Vorschau öffnen' : undefined"
    :aria-label="klickbar ? `Vorschau von ${fileName || 'Dokument'}` : undefined"
    @click="klickbar && emit('klick')"
  >
    <img
      v-if="src && !fehler"
      :src="src"
      alt=""
      class="absolute inset-0 size-full object-cover object-top"
      :class="geladen ? 'opacity-100' : 'opacity-0'"
      loading="lazy"
      @load="geladen = true"
      @error="fehler = true"
    >
    <span
      v-if="!src || fehler || !geladen"
      class="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gradient-to-b from-surface to-surface-sunken text-ink-subtle"
    >
      <UiIcon :name="icon" fest class="text-lg opacity-80" />
      <span
        v-if="dateiEndung(fileName)"
        class="text-[0.6rem] font-semibold uppercase tracking-wide"
      >
        {{ dateiEndung(fileName) }}
      </span>
    </span>
  </component>
</template>
