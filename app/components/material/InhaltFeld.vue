<script setup lang="ts">
withDefaults(
  defineProps<{
    einklappId: string
    disabled?: boolean
    /** Ab dieser Zeichenanzahl standardmäßig eingeklappt (ohne gespeicherte Präferenz). */
    langGrenze?: number
  }>(),
  { langGrenze: 480 },
)

const wert = defineModel<string | null>()
</script>

<template>
  <UiEinklappbaresFeld
    v-model="wert"
    label="Inhalt / Textfassung"
    :einklapp-id="einklappId"
    :schwellwert="langGrenze"
    :zeilen="8"
    leer-vorschau="Kein Inhalt"
    placeholder="Volltext, extrahierter Dateiinhalt oder KI-Zusammenfassung (Markdown möglich) …"
    hinweis="Langer Inhalt – innerhalb des Feldes scrollen. Markdown (Überschriften, Listen) bleibt als Text editierbar."
    :disabled="disabled"
  />
</template>
