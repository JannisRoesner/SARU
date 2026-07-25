<script setup lang="ts">
import { FARBDESIGNS, type FarbdesignId, type Farbmodus } from '~/composables/useDarstellung'

useHead({ title: 'Darstellung' })

const { modus, design, setzen } = useDarstellung()
const { istAdmin } = useSitzung()
const { aufruf, laeuft } = useApi()

const modi: { id: Farbmodus; label: string; icon: string }[] = [
  { id: 'hell', label: 'Hell', icon: 'sun' },
  { id: 'dunkel', label: 'Dunkel', icon: 'moon' },
  { id: 'system', label: 'System', icon: 'desktop' },
]

const instanzName = ref('SARU')
const standardModus = ref<Farbmodus>('system')
const standardPalette = ref<FarbdesignId>('indigo')

if (istAdmin.value) {
  const { data } = await useFetch<{
    appearance: { instanceName: string; defaultTheme: Farbmodus; defaultPalette: string }
  }>('/api/settings')
  watch(
    data,
    (wert) => {
      if (!wert?.appearance) return
      instanzName.value = wert.appearance.instanceName
      standardModus.value = wert.appearance.defaultTheme
      standardPalette.value = (wert.appearance.defaultPalette as FarbdesignId) || 'indigo'
    },
    { immediate: true },
  )
}

async function instanzSpeichern() {
  await aufruf('/api/settings/appearance', {
    method: 'PATCH',
    body: {
      instanceName: instanzName.value,
      defaultTheme: standardModus.value,
      defaultPalette: standardPalette.value,
    },
    erfolgsmeldung: 'Instanzdarstellung gespeichert.',
  })
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <div class="mb-2">
      <NuxtLink to="/einstellungen" class="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary">
        <UiIcon name="arrow-left" fest /> Einstellungen
      </NuxtLink>
    </div>

    <LayoutSeitenkopf
      kicker="Persönlich"
      titel="Darstellung"
      untertitel="Farbmodus und Palette gelten für dich – geräteübergreifend über dein Konto."
    />

    <UiCard titel="Farbmodus" icon="circle-half-stroke" class="mb-5">
      <div class="grid gap-2 sm:grid-cols-3">
        <button
          v-for="m in modi"
          :key="m.id"
          type="button"
          class="flex items-center gap-2 rounded-xl border px-4 py-3 text-sm transition-colors"
          :class="modus === m.id ? 'border-primary bg-primary-soft text-primary-strong' : 'border-line hover:bg-surface-hover'"
          @click="setzen({ modus: m.id })"
        >
          <UiIcon :name="m.icon" fest />
          {{ m.label }}
        </button>
      </div>
    </UiCard>

    <UiCard titel="Farbdesign" icon="palette" class="mb-5">
      <div class="grid gap-3 sm:grid-cols-2">
        <button
          v-for="d in FARBDESIGNS"
          :key="d.id"
          type="button"
          class="flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors"
          :class="design === d.id ? 'border-primary bg-primary-soft' : 'border-line hover:bg-surface-hover'"
          @click="setzen({ design: d.id })"
        >
          <span class="flex gap-1">
            <span class="size-5 rounded-full" :style="{ background: d.primaer }" />
            <span class="size-5 rounded-full" :style="{ background: d.akzent }" />
          </span>
          <span class="text-sm font-medium text-ink">{{ d.name }}</span>
        </button>
      </div>
    </UiCard>

    <UiCard v-if="istAdmin" titel="Instanz-Standards" icon="building">
      <div class="space-y-4">
        <UiField label="Anzeigename der Instanz">
          <UiInput v-model="instanzName" />
        </UiField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UiField label="Standard-Farbmodus">
            <UiSelect
              v-model="standardModus"
              :optionen="modi.map((m) => ({ value: m.id, label: m.label }))"
            />
          </UiField>
          <UiField label="Standard-Palette">
            <UiSelect
              v-model="standardPalette"
              :optionen="FARBDESIGNS.map((d) => ({ value: d.id, label: d.name }))"
            />
          </UiField>
        </div>
        <div class="flex justify-end">
          <UiButton variante="primaer" icon="floppy-disk" :laedt="laeuft" @click="instanzSpeichern">
            Speichern
          </UiButton>
        </div>
      </div>
    </UiCard>
  </div>
</template>
