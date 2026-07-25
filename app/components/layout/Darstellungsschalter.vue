<script setup lang="ts">
const { modus, design, istDunkel, setzen } = useDarstellung()

const offen = ref(false)
const wurzel = ref<HTMLElement | null>(null)

const MODI = [
  { id: 'hell', label: 'Hell', icon: 'sun' },
  { id: 'dunkel', label: 'Dunkel', icon: 'moon' },
  { id: 'system', label: 'System', icon: 'desktop' },
] as const

function beiKlickAussen(event: MouseEvent) {
  if (offen.value && !wurzel.value?.contains(event.target as Node)) offen.value = false
}

onMounted(() => document.addEventListener('click', beiKlickAussen))
onBeforeUnmount(() => document.removeEventListener('click', beiKlickAussen))
</script>

<template>
  <div ref="wurzel" class="relative">
    <UiButton
      variante="still"
      :icon="istDunkel ? 'moon' : 'sun'"
      nur-icon
      title="Darstellung anpassen"
      :aria-expanded="offen"
      @click="offen = !offen"
    />

    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 -translate-y-1 scale-95"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="offen"
        class="absolute top-full right-0 z-40 mt-2 w-64 rounded-xl border border-line bg-surface-raised p-3 shadow-[--shadow-raised]"
      >
        <p class="mb-2 text-xs font-semibold tracking-wide text-ink-subtle uppercase">Modus</p>
        <div class="mb-4 grid grid-cols-3 gap-1.5">
          <button
            v-for="m in MODI"
            :key="m.id"
            type="button"
            class="flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-xs transition-colors"
            :class="
              modus === m.id
                ? 'border-primary bg-primary-soft text-primary-strong'
                : 'border-line text-ink-muted hover:bg-surface-hover'
            "
            @click="setzen({ modus: m.id })"
          >
            <UiIcon :name="m.icon" />
            {{ m.label }}
          </button>
        </div>

        <p class="mb-2 text-xs font-semibold tracking-wide text-ink-subtle uppercase">Farbdesign</p>
        <div class="space-y-1">
          <button
            v-for="farbdesign in FARBDESIGNS"
            :key="farbdesign.id"
            type="button"
            class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors"
            :class="design === farbdesign.id ? 'bg-primary-soft text-primary-strong' : 'text-ink-muted hover:bg-surface-hover'"
            @click="setzen({ design: farbdesign.id })"
          >
            <span class="flex shrink-0 gap-0.5">
              <span class="size-4 rounded-l-full" :style="{ background: farbdesign.primaer }" />
              <span class="size-4 rounded-r-full" :style="{ background: farbdesign.akzent }" />
            </span>
            <span class="flex-1 truncate">{{ farbdesign.name }}</span>
            <UiIcon v-if="design === farbdesign.id" name="check" class="text-xs" />
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>
