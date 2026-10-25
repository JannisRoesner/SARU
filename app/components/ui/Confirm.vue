<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    titel: string
    text: string
    bestaetigen?: string
    abbrechen?: string
    gefahr?: boolean
    icon?: string
    /** Bei destruktiven Aktionen: exakt diesen Text eintippen lassen. */
    tippBestaetigung?: string | null
    /** Beschriftung einer zweiten, weitergehenden Bestätigung (z. B. „Mit Inhalt löschen“). */
    zusatz?: string | null
  }>(),
  {
    bestaetigen: 'Bestätigen',
    abbrechen: 'Abbrechen',
    gefahr: false,
    icon: undefined,
    tippBestaetigung: null,
    zusatz: null,
  },
)

const emit = defineEmits<{ bestaetigt: []; zusatzBestaetigt: []; abgebrochen: [] }>()
const offen = defineModel<boolean>({ required: true })

const eingabe = ref('')
const laeuft = ref<'haupt' | 'zusatz' | null>(null)

const freigegeben = computed(
  () => !props.tippBestaetigung || eingabe.value.trim() === props.tippBestaetigung,
)

watch(offen, (istOffen) => {
  if (istOffen) {
    eingabe.value = ''
    laeuft.value = null
  }
})

async function bestaetigenKlick() {
  if (!freigegeben.value) return
  laeuft.value = 'haupt'
  emit('bestaetigt')
}

function zusatzKlick() {
  if (!freigegeben.value) return
  laeuft.value = 'zusatz'
  emit('zusatzBestaetigt')
}

function abbrechenKlick() {
  offen.value = false
  emit('abgebrochen')
}
</script>

<template>
  <UiModal v-model="offen" :titel="titel" :icon="icon ?? (gefahr ? 'triangle-exclamation' : 'circle-question')" breite="sm">
    <p class="text-sm leading-relaxed text-ink-muted">{{ text }}</p>

    <div v-if="tippBestaetigung" class="mt-4">
      <UiField :label="`Zum Bestätigen „${tippBestaetigung}“ eingeben`">
        <UiInput v-model="eingabe" data-autofokus :placeholder="tippBestaetigung" />
      </UiField>
    </div>

    <template #aktionen>
      <UiButton variante="sekundaer" @click="abbrechenKlick">{{ abbrechen }}</UiButton>
      <UiButton
        :variante="gefahr ? 'gefahr' : 'primaer'"
        :disabled="!freigegeben || laeuft === 'zusatz'"
        :laedt="laeuft === 'haupt'"
        data-autofokus
        @click="bestaetigenKlick"
      >
        {{ bestaetigen }}
      </UiButton>
      <UiButton
        v-if="zusatz"
        :variante="gefahr ? 'gefahr' : 'primaer'"
        :disabled="!freigegeben || laeuft === 'haupt'"
        :laedt="laeuft === 'zusatz'"
        @click="zusatzKlick"
      >
        {{ zusatz }}
      </UiButton>
    </template>
  </UiModal>
</template>
