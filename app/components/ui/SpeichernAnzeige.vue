<script setup lang="ts">
import type { SpeicherZustand } from '~/composables/useAutosave'

const props = defineProps<{
  zustand: SpeicherZustand
  fehler?: string | null
  zuletzt?: Date | null
}>()

const jetzt = useJetzt()

const text = computed(() => {
  switch (props.zustand) {
    case 'geaendert':
      return 'Ungespeicherte Änderungen'
    case 'speichert':
      return 'Speichert …'
    case 'gespeichert':
      return props.zuletzt
        ? `Gespeichert ${formatRelativ(props.zuletzt, '–', jetzt.value)}`
        : 'Gespeichert'
    case 'fehler':
      return props.fehler ?? 'Speichern fehlgeschlagen'
    default:
      return 'Alle Änderungen gespeichert'
  }
})

const icon = computed(() => {
  switch (props.zustand) {
    case 'speichert':
      return 'circle-notch'
    case 'fehler':
      return 'triangle-exclamation'
    case 'geaendert':
      return 'pen'
    default:
      return 'check'
  }
})
</script>

<template>
  <span
    class="speicher-anzeige"
    :class="{
      'text-warning': zustand === 'geaendert',
      'text-danger': zustand === 'fehler',
      'text-success': zustand === 'gespeichert',
    }"
    role="status"
  >
    <UiIcon :name="icon" fest :dreht="zustand === 'speichert'" />
    {{ text }}
  </span>
</template>
