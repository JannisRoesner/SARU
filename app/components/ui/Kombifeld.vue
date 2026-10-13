<script setup lang="ts">
export interface KombiOption {
  wert: string
  /** Kleine Zusätze rechts, z. B. „Bild“ oder ein Alias. */
  zusaetze?: string[]
  /** Andere Namen derselben Option (Aliase) – zählen als ausgewählt und beim Suchen. */
  gleichwertig?: string[]
  /** Passt vermutlich nicht – wird unter „Weitere“ gelistet. */
  nachrangig?: boolean
}

/**
 * Texteingabe mit aufklappbarer Vorschlagsliste. Anders als ein `<datalist>`
 * zeigt die Liste beim Öffnen alle Vorschläge und filtert erst beim Tippen;
 * freie Eingaben bleiben jederzeit möglich.
 */
const props = withDefaults(
  defineProps<{
    optionen: KombiOption[]
    placeholder?: string
    disabled?: boolean
    laedt?: boolean
    leerText?: string
  }>(),
  { placeholder: undefined, leerText: 'Keine Vorschläge' },
)

const wert = defineModel<string>({ required: true })
const id = inject<string | undefined>('feld-id', undefined)
const listeId = useId()

const offen = ref(false)
const filtern = ref(false)
const aktiv = ref(-1)
const eingabe = ref<HTMLInputElement | null>(null)

const sichtbar = computed(() => {
  const suche = filtern.value ? wert.value.trim().toLowerCase() : ''
  const treffer = suche
    ? props.optionen.filter((o) =>
        [o.wert, ...(o.gleichwertig ?? []), ...(o.zusaetze ?? [])].some((t) => t.toLowerCase().includes(suche)),
      )
    : props.optionen
  return [...treffer.filter((o) => !o.nachrangig), ...treffer.filter((o) => o.nachrangig)]
})
const ersteNachrangige = computed(() => sichtbar.value.findIndex((o) => o.nachrangig))

function gewaehlt(option: KombiOption): boolean {
  const aktuell = wert.value.trim()
  return option.wert === aktuell || Boolean(option.gleichwertig?.includes(aktuell))
}

function oeffnen() {
  if (props.disabled) return
  filtern.value = false
  aktiv.value = sichtbar.value.findIndex(gewaehlt)
  offen.value = true
}

function waehlen(option: KombiOption) {
  wert.value = option.wert
  offen.value = false
  eingabe.value?.focus()
}

function tippen() {
  filtern.value = true
  offen.value = true
  aktiv.value = -1
}

function taste(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!offen.value) return oeffnen()
    const anzahl = sichtbar.value.length
    if (!anzahl) return
    aktiv.value = (aktiv.value + (event.key === 'ArrowDown' ? 1 : -1) + anzahl) % anzahl
  } else if (event.key === 'Enter' && offen.value && sichtbar.value[aktiv.value]) {
    event.preventDefault()
    waehlen(sichtbar.value[aktiv.value]!)
  } else if (event.key === 'Escape' && offen.value) {
    event.preventDefault()
    offen.value = false
  }
}
</script>

<template>
  <div class="relative" @focusout="(e) => !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node) && (offen = false)">
    <input
      :id="id"
      ref="eingabe"
      v-model="wert"
      type="text"
      role="combobox"
      autocomplete="off"
      spellcheck="false"
      :aria-expanded="offen"
      :aria-controls="listeId"
      :placeholder="placeholder"
      :disabled="disabled"
      class="h-10 w-full rounded-lg border border-line bg-surface pr-9 pl-3 text-sm text-ink transition-colors placeholder:text-ink-subtle hover:border-line-strong focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-subtle"
      @input="tippen"
      @keydown="taste"
      @click="!offen && oeffnen()"
    >
    <button
      type="button"
      tabindex="-1"
      class="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-ink-subtle hover:text-ink"
      :aria-label="offen ? 'Vorschläge schließen' : 'Vorschläge anzeigen'"
      :disabled="disabled"
      @click="offen ? (offen = false) : (oeffnen(), eingabe?.focus())"
    >
      <UiIcon :name="laedt ? 'spinner' : 'chevron-down'" :class="[laedt && 'animate-spin', 'text-xs']" />
    </button>

    <ul
      v-if="offen"
      :id="listeId"
      role="listbox"
      class="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg"
    >
      <template v-for="(option, i) in sichtbar" :key="option.wert">
        <li v-if="i === ersteNachrangige && i > 0" class="px-3 pt-2 pb-1 text-xs text-ink-subtle" role="presentation">
          Weitere
        </li>
        <li
          role="option"
          :aria-selected="gewaehlt(option)"
          class="flex cursor-pointer items-start gap-2 px-3 py-1.5 text-sm"
          :class="[
            i === aktiv ? 'bg-surface-sunken' : 'hover:bg-surface-sunken',
            option.nachrangig ? 'text-ink-muted' : 'text-ink',
          ]"
          @mousedown.prevent="waehlen(option)"
          @mousemove="aktiv = i"
        >
          <span class="w-3 shrink-0 pt-0.5">
            <UiIcon v-if="gewaehlt(option)" name="check" fest class="text-xs text-primary" />
          </span>
          <!-- Zweizeilig, damit lange Modellnamen nie abgeschnitten werden. -->
          <span class="min-w-0 flex-1">
            <span class="block break-all">{{ option.wert }}</span>
            <span v-if="option.zusaetze?.length" class="block break-all text-xs text-ink-subtle">
              {{ option.zusaetze.join(' · ') }}
            </span>
          </span>
        </li>
      </template>
      <li v-if="!sichtbar.length" class="px-3 py-1.5 text-sm text-ink-subtle">{{ laedt ? 'Lädt …' : leerText }}</li>
    </ul>
  </div>
</template>
