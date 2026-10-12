<script setup lang="ts">
import { materialTypes } from '#shared/utils/labels'

/** Material in einem Freigabe-Link: Miniatur, Titel, Vorschau und Download direkt an der Karte. */
const props = defineProps<{
  token: string
  material: {
    id: string
    title: string
    materialType: string
    vorschauDateiId: string | null
    vorschauDateiname: string | null
    vorschauMimeType: string | null
  }
}>()

const { ziel } = useGastNavigation()
const basis = computed(() => `/api/geteilt/${props.token}/dateien`)
const vorschauOffen = ref(false)

function herunterladen() {
  if (props.material.vorschauDateiId) window.open(`${basis.value}/${props.material.vorschauDateiId}/download`, '_blank')
}
</script>

<template>
  <div class="karte flex flex-wrap items-center gap-3 p-3">
    <MaterialVorschauMiniatur
      :asset-id="material.vorschauDateiId"
      :file-name="material.vorschauDateiname"
      :mime-type="material.vorschauMimeType"
      :material-type="material.materialType"
      :api-basis="basis"
      groesse="sm"
      :klickbar="Boolean(material.vorschauDateiId)"
      @klick="vorschauOffen = true"
    />
    <NuxtLink :to="ziel(`/geteilt/${token}/material/${material.id}`)" class="min-w-0 flex-1">
      <span class="block truncate font-medium text-ink hover:text-primary">{{ material.title }}</span>
      <span class="text-xs text-ink-subtle">{{ materialTypes.label(material.materialType as never) }}</span>
    </NuxtLink>
    <div v-if="material.vorschauDateiId" class="flex shrink-0 gap-1.5">
      <UiButton variante="sekundaer" groesse="sm" icon="eye" title="Ansehen" @click="vorschauOffen = true">
        <span class="hidden sm:inline">Ansehen</span>
      </UiButton>
      <UiButton variante="sekundaer" groesse="sm" icon="download" title="Herunterladen" @click="herunterladen">
        <span class="hidden sm:inline">Herunterladen</span>
      </UiButton>
    </div>
    <MaterialVorschauModal
      v-if="material.vorschauDateiId"
      v-model="vorschauOffen"
      :asset-id="material.vorschauDateiId"
      :titel="material.title"
      :api-basis="basis"
    />
  </div>
</template>
