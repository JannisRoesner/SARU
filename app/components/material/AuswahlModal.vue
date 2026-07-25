<script setup lang="ts">
import type { MaterialSummary } from '~~/server/repositories/material.repository'
import type { Paginated } from '#shared/types/domain'

const offen = defineModel<boolean>({ required: true })

const props = withDefaults(
  defineProps<{
    titel?: string
    ausschliessen?: string[]
  }>(),
  { titel: 'Material hinzufügen', ausschliessen: () => [] },
)

const emit = defineEmits<{ ausgewaehlt: [material: MaterialSummary] }>()

const suche = ref('')
const page = ref(1)

const query = computed(() => ({
  q: suche.value.trim() || undefined,
  page: page.value,
  pageSize: 12,
  sort: suche.value.trim() ? 'relevanz' : 'datum_neu',
}))

const { data, status, refresh } = await useFetch<Paginated<MaterialSummary> & { query: string | null }>(
  '/api/materials',
  { query, watch: [query] },
)

const eintraege = computed(() =>
  (data.value?.items ?? []).filter((m) => !props.ausschliessen.includes(m.id)),
)

watch(offen, (wert) => {
  if (wert) {
    suche.value = ''
    page.value = 1
    void refresh()
  }
})

function waehlen(material: MaterialSummary) {
  emit('ausgewaehlt', material)
  offen.value = false
}
</script>

<template>
  <UiModal v-model="offen" :titel="titel" icon="folder-open" breite="lg">
    <UiField label="Suche">
      <UiInput v-model="suche" icon="magnifying-glass" placeholder="Titel, Schlagwort …" />
    </UiField>

    <div class="mt-4 max-h-[50vh] space-y-2 overflow-y-auto">
      <UiSkelett v-if="status === 'pending'" art="list" :zeilen="4" />
      <UiLeerzustand
        v-else-if="!eintraege.length"
        klein
        icon="folder-open"
        titel="Keine Materialien"
        text="Passe die Suche an oder lege zuerst ein Material an."
      />
      <button
        v-for="material in eintraege"
        :key="material.id"
        type="button"
        class="karte flex w-full items-start gap-3 p-3 text-left transition-shadow hover:shadow-md"
        @click="waehlen(material)"
      >
        <span class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
          <UiIcon name="file-lines" fest />
        </span>
        <span class="min-w-0">
          <span class="block truncate font-medium text-ink">{{ material.title }}</span>
          <span class="mt-0.5 block truncate text-xs text-ink-muted">
            {{ material.subjects.map((s) => s.name).join(' · ') || 'Ohne Fach' }}
          </span>
        </span>
      </button>
    </div>

    <template #aktionen>
      <UiButton variante="sekundaer" @click="offen = false">Abbrechen</UiButton>
    </template>
  </UiModal>
</template>
