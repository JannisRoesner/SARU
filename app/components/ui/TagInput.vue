<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    platzhalter?: string
    /** Vorschläge aus dem vorhandenen Bestand. */
    vorschlaege?: string[]
    disabled?: boolean
    max?: number
  }>(),
  { platzhalter: 'Hinzufügen und Enter drücken', vorschlaege: () => [], max: 60 },
)

const werte = defineModel<string[]>({ default: () => [] })
const id = inject<string | undefined>('feld-id', undefined)

const eingabe = ref('')
const listeOffen = ref(false)
const markiert = ref(-1)

const passende = computed(() => {
  const suche = eingabe.value.trim().toLowerCase()
  return props.vorschlaege
    .filter((v) => !werte.value.some((w) => w.toLowerCase() === v.toLowerCase()))
    .filter((v) => !suche || v.toLowerCase().includes(suche))
    .slice(0, 8)
})

function hinzufuegen(text: string) {
  const sauber = text.trim()
  if (!sauber || werte.value.length >= props.max) return
  // Groß-/Kleinschreibung soll keine Dubletten erzeugen.
  if (werte.value.some((w) => w.toLowerCase() === sauber.toLowerCase())) {
    eingabe.value = ''
    return
  }
  werte.value = [...werte.value, sauber]
  eingabe.value = ''
  markiert.value = -1
}

function entfernen(index: number) {
  werte.value = werte.value.filter((_, i) => i !== index)
}

function beiTaste(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault()
    hinzufuegen(markiert.value >= 0 ? passende.value[markiert.value]! : eingabe.value)
    return
  }
  if (event.key === 'Backspace' && !eingabe.value && werte.value.length) {
    entfernen(werte.value.length - 1)
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    markiert.value = Math.min(markiert.value + 1, passende.value.length - 1)
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    markiert.value = Math.max(markiert.value - 1, -1)
  }
  if (event.key === 'Escape') listeOffen.value = false
}
</script>

<template>
  <div class="relative">
    <div
      class="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface p-1.5 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20"
      :class="disabled && 'bg-surface-sunken'"
    >
      <TransitionGroup name="liste">
        <span
          v-for="(wert, index) in werte"
          :key="wert"
          class="inline-flex items-center gap-1 rounded-md bg-primary-soft py-0.5 pr-1 pl-2 text-xs font-medium text-primary-strong"
        >
          {{ wert }}
          <button
            v-if="!disabled"
            type="button"
            class="rounded p-0.5 transition-colors hover:bg-primary/20"
            :title="`„${wert}“ entfernen`"
            @click="entfernen(index)"
          >
            <UiIcon name="xmark" class="text-[0.7rem]" />
          </button>
        </span>
      </TransitionGroup>

      <input
        :id="id"
        v-model="eingabe"
        :placeholder="werte.length ? '' : platzhalter"
        :disabled="disabled || werte.length >= max"
        class="h-7 min-w-[8rem] flex-1 bg-transparent px-1 text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
        @keydown="beiTaste"
        @focus="listeOffen = true"
        @blur="setTimeout(() => (listeOffen = false), 150)"
      >
    </div>

    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 -translate-y-1"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="opacity-0"
    >
      <ul
        v-if="listeOffen && passende.length"
        class="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-surface-raised py-1 shadow-[--shadow-raised]"
      >
        <li v-for="(vorschlag, index) in passende" :key="vorschlag">
          <button
            type="button"
            class="w-full px-3 py-1.5 text-left text-sm transition-colors"
            :class="index === markiert ? 'bg-primary-soft text-primary-strong' : 'hover:bg-surface-hover'"
            @mousedown.prevent="hinzufuegen(vorschlag)"
          >
            {{ vorschlag }}
          </button>
        </li>
      </ul>
    </Transition>
  </div>
</template>
