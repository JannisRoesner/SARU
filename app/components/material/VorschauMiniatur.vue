<script setup lang="ts">
import { isThumbnailCandidate } from '#shared/utils/thumbnail-candidate'
import { istMoodleBackupDatei, istMoodleKursMaterial, istH5pDatei, istH5pMaterial, materialVorschauIcon, materialZeigtIconVorschau } from '#shared/utils/moodle'

/**
 * Papierähnliche Dokument-Miniatur (paperless-Stil).
 * Lädt die Miniatur per fetch (kein <img src> auf 404 → weniger Konsolen-Spam)
 * und fällt bei Fehler auf Icon-Platzhalter zurück.
 */
const props = withDefaults(
  defineProps<{
    assetId?: string | null
    fileName?: string | null
    mimeType?: string | null
    materialType?: string | null
    /** Kompakte Kachel in Listen. */
    groesse?: 'sm' | 'md' | 'lg'
    klickbar?: boolean
  }>(),
  { groesse: 'md', klickbar: false },
)

const emit = defineEmits<{ klick: [] }>()

const geladen = ref(false)
const fehler = ref(false)
const src = ref<string | null>(null)
let objectUrl: string | null = null

const zeigtIconVorschau = computed(
  () => materialZeigtIconVorschau(props.materialType, props.fileName),
)

const vorschauStil = computed<'moodle' | 'h5p' | null>(() => {
  if (istMoodleKursMaterial(props.materialType) || istMoodleBackupDatei(props.fileName)) return 'moodle'
  if (istH5pMaterial(props.materialType) || istH5pDatei(props.fileName)) return 'h5p'
  return null
})

const hatMiniatur = computed(() => {
  if (zeigtIconVorschau.value) return false
  if (!props.assetId) return false
  return isThumbnailCandidate(props.mimeType, props.fileName)
})

const icon = computed(() => materialVorschauIcon(props.materialType, props.fileName))

const mass = computed(() => {
  if (props.groesse === 'sm') return 'h-14 w-11'
  if (props.groesse === 'lg') return 'h-40 w-28'
  return 'h-24 w-[4.5rem]'
})

function revokeObjectUrl() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }
}

async function ladeMiniatur(assetId: string) {
  geladen.value = false
  fehler.value = false
  revokeObjectUrl()
  src.value = null

  try {
    const response = await fetch(`/api/assets/${assetId}/thumbnail`, {
      credentials: 'same-origin',
    })
    if (!response.ok) {
      fehler.value = true
      return
    }
    const blob = await response.blob()
    objectUrl = URL.createObjectURL(blob)
    src.value = objectUrl
  } catch {
    fehler.value = true
  }
}

watch(
  () => (hatMiniatur.value ? props.assetId : null),
  (assetId) => {
    if (!assetId) {
      geladen.value = false
      fehler.value = false
      revokeObjectUrl()
      src.value = null
      return
    }
    void ladeMiniatur(assetId)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  revokeObjectUrl()
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
      :class="[
        vorschauStil === 'moodle' && 'moodle-vorschau',
        vorschauStil === 'h5p' && 'h5p-vorschau',
      ]"
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

<style scoped>
.moodle-vorschau {
  background: linear-gradient(160deg, rgb(249 128 18 / 0.14), var(--surface-sunken));
  color: #f98012;
}

.h5p-vorschau {
  background: linear-gradient(160deg, color-mix(in oklch, var(--color-accent) 16%, transparent), var(--surface-sunken));
  color: var(--color-accent);
}
</style>
