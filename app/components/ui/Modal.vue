<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    titel: string
    beschreibung?: string
    icon?: string
    breite?: 'sm' | 'md' | 'lg' | 'xl'
    /** Schließen per Escape oder Klick auf den Hintergrund unterbinden. */
    fest?: boolean
  }>(),
  { breite: 'md', fest: false },
)

const offen = defineModel<boolean>({ required: true })

const BREITEN = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' } as const

const dialog = ref<HTMLElement | null>(null)
const titelId = useId()

function schliessen() {
  if (!props.fest) offen.value = false
}

function beiTaste(event: KeyboardEvent) {
  if (!offen.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    schliessen()
    return
  }
  // Fokus im Dialog halten, solange er offen ist.
  if (event.key !== 'Tab' || !dialog.value) return
  const fokussierbar = dialog.value.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
  )
  if (!fokussierbar.length) return
  const erstes = fokussierbar[0]!
  const letztes = fokussierbar[fokussierbar.length - 1]!

  if (event.shiftKey && document.activeElement === erstes) {
    event.preventDefault()
    letztes.focus()
  } else if (!event.shiftKey && document.activeElement === letztes) {
    event.preventDefault()
    erstes.focus()
  }
}

watch(offen, async (istOffen) => {
  if (!import.meta.client) return
  document.body.style.overflow = istOffen ? 'hidden' : ''
  if (istOffen) {
    await nextTick()
    dialog.value?.querySelector<HTMLElement>('[data-autofokus]')?.focus() ??
      dialog.value?.focus()
  }
})

onMounted(() => document.addEventListener('keydown', beiTaste))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', beiTaste)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div v-if="offen" class="fixed inset-0 z-50 overflow-y-auto">
        <div class="fixed inset-0 bg-slate-950/50 backdrop-blur-[2px]" @click="schliessen" />

        <div class="flex min-h-full items-end justify-center p-0 sm:items-center sm:p-6">
          <Transition
            appear
            enter-active-class="transition duration-250 ease-[cubic-bezier(0.22,1,0.36,1)]"
            enter-from-class="opacity-0 translate-y-6 sm:scale-95 sm:translate-y-0"
            leave-active-class="transition duration-150 ease-in"
            leave-to-class="opacity-0 sm:scale-95"
          >
            <div
              v-if="offen"
              ref="dialog"
              role="dialog"
              aria-modal="true"
              :aria-labelledby="titelId"
              tabindex="-1"
              class="relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-surface shadow-[--shadow-raised] sm:rounded-2xl"
              :class="BREITEN[breite]"
            >
              <header class="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
                <div class="min-w-0">
                  <h2 :id="titelId" class="flex items-center gap-2.5 text-lg font-semibold text-ink">
                    <UiIcon v-if="icon" :name="icon" class="text-primary" />
                    {{ titel }}
                  </h2>
                  <p v-if="beschreibung" class="mt-1 text-sm text-ink-muted">{{ beschreibung }}</p>
                </div>
                <UiButton
                  v-if="!fest"
                  variante="still"
                  groesse="sm"
                  icon="xmark"
                  nur-icon
                  title="Schließen"
                  @click="schliessen"
                />
              </header>

              <div class="flex-1 overflow-y-auto px-6 py-5">
                <slot />
              </div>

              <footer
                v-if="$slots.aktionen"
                class="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-sunken px-6 py-4"
              >
                <slot name="aktionen" />
              </footer>
            </div>
          </Transition>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
