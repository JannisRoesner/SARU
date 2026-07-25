<script setup lang="ts">
import {
  type GradeLevel,
  formatJahrgaenge,
  jahrgangsstufeKurz,
  jahrgangsstufeLabel,
  sortGradeLevels,
} from '#shared/utils/jahrgangsstufen'

const props = withDefaults(
  defineProps<{
    disabled?: boolean
  }>(),
  { disabled: false },
)

const model = defineModel<GradeLevel[]>({ default: () => [] })

const { jahrgangsstufenGruppen: gruppen } = useSchulformen()

const auswahlText = computed(() =>
  model.value.length ? formatJahrgaenge(model.value) : 'Keine ausgewählt',
)

function istAktiv(stufe: GradeLevel) {
  return model.value.includes(stufe)
}

function umschalten(stufe: GradeLevel) {
  if (props.disabled) return
  const next = [...model.value]
  const idx = next.indexOf(stufe)
  if (idx >= 0) next.splice(idx, 1)
  else next.push(stufe)
  model.value = sortGradeLevels(next)
}

function gruppeUmschalten(stufen: readonly GradeLevel[]) {
  if (props.disabled) return
  const alleAktiv = stufen.every((s) => model.value.includes(s))
  if (alleAktiv) {
    model.value = model.value.filter((s) => !stufen.includes(s))
    return
  }
  model.value = sortGradeLevels([...new Set([...model.value, ...stufen])])
}

function alleLoeschen() {
  if (props.disabled || !model.value.length) return
  model.value = []
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p
        class="text-sm"
        :class="model.length ? 'font-medium text-ink' : 'text-ink-muted'"
        aria-live="polite"
      >
        {{ auswahlText }}
      </p>
      <button
        v-if="model.length && !disabled"
        type="button"
        class="text-xs font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline"
        @click="alleLoeschen"
      >
        Auswahl löschen
      </button>
    </div>

    <div
      v-for="gruppe in gruppen"
      :key="gruppe.id"
      role="group"
      :aria-label="gruppe.label"
      class="rounded-xl border border-line bg-surface-sunken/40 p-3"
    >
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span class="text-xs font-semibold tracking-wide text-ink-subtle uppercase">
          {{ gruppe.label }}
        </span>
        <button
          v-if="!disabled"
          type="button"
          class="text-xs text-ink-muted underline-offset-2 hover:text-primary hover:underline"
          @click="gruppeUmschalten(gruppe.stufen)"
        >
          {{ gruppe.stufen.every((s) => istAktiv(s)) ? 'Keine' : 'Alle' }}
        </button>
      </div>

      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="stufe in gruppe.stufen"
          :key="String(stufe)"
          type="button"
          class="filter-chip min-w-[2.5rem] justify-center tabular-nums"
          :class="istAktiv(stufe) && 'filter-chip-aktiv'"
          :disabled="disabled"
          :aria-pressed="istAktiv(stufe)"
          :aria-label="jahrgangsstufeLabel(stufe)"
          @click="umschalten(stufe)"
        >
          {{ jahrgangsstufeKurz(stufe) }}
        </button>
      </div>
    </div>

    <p class="text-xs text-ink-subtle">
      Mehrfachauswahl – klicke die passenden Jahrgänge an.
    </p>
  </div>
</template>
