<script setup lang="ts">
import type { Paginated } from '#shared/types/domain'
import type { MaterialSummary } from '~~/server/repositories/material.repository'

const NEU = '__neu__'

const zuordnen = defineModel<boolean>('zuordnen', { default: false })
const lehrwerkId = defineModel<string | null>('lehrwerkId')
const titel = defineModel<string>('titel', { default: '' })

const { data } = await useFetch<Paginated<MaterialSummary>>('/api/materials', {
  query: { materialTypes: 'lehrwerk', pageSize: 100, sort: 'datum_neu' },
})

const optionen = computed(() => [
  ...(data.value?.items ?? []).map((item) => ({ value: item.id, label: item.title })),
  { value: NEU, label: 'Neues Lehrwerk anlegen …' },
])

const auswahl = computed({
  get() {
    if (!zuordnen.value) return null
    return lehrwerkId.value || NEU
  },
  set(wert) {
    if (wert === NEU || wert == null) lehrwerkId.value = null
    else lehrwerkId.value = String(wert)
  },
})

watch(zuordnen, (an) => {
  if (!an) {
    lehrwerkId.value = null
    return
  }
  if (!lehrwerkId.value && !titel.value.trim() && data.value?.items[0]) {
    lehrwerkId.value = data.value.items[0].id
  }
})
</script>

<template>
  <div class="sm:col-span-2 space-y-3">
    <label class="flex items-center gap-2 text-sm">
      <input v-model="zuordnen" type="checkbox" class="accent-[var(--color-primary)]">
      Alles einem Lehrwerk zuordnen
    </label>
    <template v-if="zuordnen">
      <UiField label="Lehrwerk">
        <UiSelect
          v-model="auswahl"
          platzhalter="Lehrwerk wählen"
          :optionen="optionen"
        />
      </UiField>
      <UiField v-if="!lehrwerkId" label="Titel des neuen Lehrwerks">
        <UiInput v-model="titel" platzhalter="z. B. Klett Biologie Oberstufe" />
      </UiField>
    </template>
  </div>
</template>
