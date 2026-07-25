<script setup lang="ts">

const props = withDefaults(

  defineProps<{

    titel?: string

    untertitel?: string

    icon?: string

    /** Ohne Innenabstand, wenn der Inhalt selbst welchen mitbringt (z. B. Tabellen). */

    blank?: boolean

    to?: string

    /** Abschnitt per Kopfzeile ein- und ausklappen. */

    einklappbar?: boolean

    /** Schlüssel für localStorage-Persistenz (z. B. `material-angaben`). */

    einklappId?: string

    /** Anfangszustand, wenn nichts gespeichert ist. */

    standardOffen?: boolean

  }>(),

  { blank: false, einklappbar: false, standardOffen: true },

)



const persistent = props.einklappbar && props.einklappId

  ? useEinklappbar(props.einklappId, props.standardOffen)

  : null

const offenLokal = ref(props.standardOffen)



const offen = computed(() => persistent?.offen.value ?? offenLokal.value)



function umschalten() {

  if (persistent) persistent.umschalten()

  else offenLokal.value = !offenLokal.value

}



const inhaltId = computed(() =>

  props.einklappbar && props.einklappId ? `einklapp-${props.einklappId}` : undefined,

)



const einklappLabel = computed(() => {

  const name = props.titel ?? 'Abschnitt'

  return offen.value ? `${name} einklappen` : `${name} ausklappen`

})

/** Grid-Animation erst nach dem ersten Paint – verhindert Scroll-Sprünge beim Seitenaufbau. */
const einklappAnimieren = ref(false)

onMounted(() => {
  nextTick(() => {
    einklappAnimieren.value = true
  })
})

</script>



<template>

  <component

    :is="to && !einklappbar ? resolveComponent('NuxtLink') : 'section'"

    :to="to && !einklappbar ? to : undefined"

    class="karte flex flex-col overflow-hidden"

    :class="to && !einklappbar && 'karte-klickbar'"

  >

    <header

      v-if="titel || $slots.kopf"

      class="flex items-center gap-x-3 border-b border-line px-5 py-3.5"

      :class="einklappbar && titel && 'cursor-pointer'"

      @click="einklappbar && titel ? umschalten() : undefined"

    >

      <div class="min-w-0 flex-1">

        <h2 v-if="titel" class="flex items-center gap-2 font-semibold text-ink">

          <UiIcon v-if="icon" :name="icon" class="shrink-0 text-primary" />

          <span class="truncate">{{ titel }}</span>

        </h2>

        <p v-if="untertitel" class="mt-0.5 text-sm text-ink-muted">{{ untertitel }}</p>

      </div>



      <div class="ml-auto flex shrink-0 items-center gap-2" @click.stop>

        <slot name="kopf" />

        <button

          v-if="einklappbar && titel"

          type="button"

          class="flex h-8 w-8 items-center justify-center rounded-lg text-ink-subtle transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"

          :aria-expanded="offen"

          :aria-controls="inhaltId"

          :aria-label="einklappLabel"

          @click="umschalten"

        >

          <UiIcon

            name="chevron-down"

            fest

            class="text-xs transition-transform duration-300 ease-[var(--ease-smooth)]"

            :class="offen && '-rotate-180'"

          />

        </button>

      </div>

    </header>



    <div

      v-if="!einklappbar"

      :class="blank ? 'flex-1' : 'flex-1 p-5'"

    >

      <slot />

    </div>



    <div

      v-else

      :id="inhaltId"

      class="grid"

      :class="[
        einklappAnimieren && 'transition-[grid-template-rows] duration-300 ease-[var(--ease-smooth)]',
        offen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      ]"

      :aria-hidden="!offen"

    >

      <div class="min-h-0 overflow-hidden">

        <div :class="blank ? 'flex-1' : 'flex-1 p-5'">

          <slot />

        </div>

      </div>

    </div>



    <footer

      v-if="$slots.fuss && (!einklappbar || offen)"

      class="border-t border-line bg-surface-sunken px-5 py-3"

    >

      <slot name="fuss" />

    </footer>

  </component>

</template>

