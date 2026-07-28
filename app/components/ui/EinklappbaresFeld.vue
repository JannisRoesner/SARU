<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    label: string
    einklappId: string
    placeholder?: string
    zeilen?: number
    disabled?: boolean
    /** Zusätzlicher Hinweis unter dem Feld (nur sichtbar wenn ausgeklappt und lang). */
    hinweis?: string
    /** Ab dieser Zeichenanzahl standardmäßig eingeklappt (ohne gespeicherte Präferenz). */
    schwellwert?: number
    /** Vorschau-Text wenn leer. */
    leerVorschau?: string
    /** Create-Seiten: kein Auto-Einklappen beim Laden. */
    immerOffen?: boolean
  }>(),
  {
    zeilen: 4,
    schwellwert: 360,
    leerVorschau: 'Kein Inhalt',
    immerOffen: false,
  },
)

const wert = defineModel<string | null>()

const { offen, umschalten } = useEinklappbar(props.einklappId, true)

const hatInhalt = computed(() => Boolean(wert.value?.trim()))
const istLang = computed(() => (wert.value?.length ?? 0) > props.schwellwert)

const vorschau = computed(() => {
  const text = wert.value?.trim()
  if (!text) return props.leerVorschau
  const eineZeile = text.replace(/\s+/g, ' ')
  return eineZeile.length > 120 ? `${eineZeile.slice(0, 120)}…` : eineZeile
})

const einklappLabel = computed(() =>
  offen.value ? `${props.label} einklappen` : `${props.label} ausklappen`,
)

const feldId = computed(() => `einklapp-${props.einklappId}`)

/**
 * Lange Inhalte nach dem Mount einklappen (wenn keine gespeicherte Präferenz).
 * Nicht während setup/SSR – sonst weicht der Client vom Server-HTML ab.
 */
onMounted(() => {
  if (props.immerOffen) return
  if (leseEinklappZustand(props.einklappId) !== null) return
  if ((wert.value?.length ?? 0) > props.schwellwert) offen.value = false
})
</script>

<template>
  <div class="min-w-0 max-w-full overflow-hidden rounded-xl border border-line bg-surface-sunken/40">
    <button
      type="button"
      class="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
      :aria-expanded="offen"
      :aria-controls="feldId"
      :aria-label="einklappLabel"
      @click="umschalten"
    >
      <span class="shrink-0 text-sm font-medium text-ink">{{ label }}</span>
      <span
        v-if="!offen"
        class="min-w-0 flex-1 truncate text-xs text-ink-subtle"
        :class="!hatInhalt && 'italic'"
      >
        {{ vorschau }}
        <span v-if="istLang" class="ml-1 text-ink-muted">· {{ wert?.length?.toLocaleString('de-DE') }} Zeichen</span>
      </span>
      <UiIcon
        name="chevron-down"
        fest
        class="ml-auto shrink-0 text-xs text-ink-subtle transition-transform duration-300 ease-[var(--ease-smooth)]"
        :class="offen && '-rotate-180'"
      />
    </button>

    <div
      v-show="offen"
      :id="feldId"
      class="border-t border-line px-3 pb-3 pt-2"
    >
      <UiTextarea
        v-model="wert"
        :zeilen="zeilen"
        :waechst="false"
        begrenzt
        :disabled="disabled"
        :placeholder="placeholder"
      />
      <p v-if="hinweis && istLang" class="mt-1.5 text-xs text-ink-subtle">
        {{ hinweis }}
      </p>
    </div>
  </div>
</template>
