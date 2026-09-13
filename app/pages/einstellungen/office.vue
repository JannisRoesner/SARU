<script setup lang="ts">
useHead({ title: 'Office-Editor' })

const { istAdmin } = useSitzung()
if (!istAdmin.value) await navigateTo('/einstellungen')

const { aufruf, laeuft } = useApi()

const { data, refresh } = await useFetch<{
  collabora: {
    enabled: boolean
    baseUrl: string
    wopiHostUrl: string
  }
}>('/api/settings')

const collabora = reactive({
  enabled: false,
  baseUrl: '',
  wopiHostUrl: '',
})

watch(
  data,
  (wert) => {
    if (!wert?.collabora) return
    Object.assign(collabora, wert.collabora)
  },
  { immediate: true },
)

const collaboraOrigin = computed(() => collabora.baseUrl.replace(/\/+$/, ''))

async function speichern() {
  await aufruf('/api/settings/collabora', {
    method: 'PATCH',
    body: {
      enabled: collabora.enabled,
      baseUrl: collabora.baseUrl.trim(),
      wopiHostUrl: collabora.wopiHostUrl.trim(),
    },
    erfolgsmeldung: 'Collabora-Einstellungen gespeichert.',
  })
  await refresh()
}
</script>

<template>
  <LayoutEinstellungsSeite>
    <LayoutSeitenkopf
      zurueck-to="/einstellungen"
      zurueck-label="Einstellungen"
      kicker="System"
      titel="Office-Editor"
      untertitel="Word, Excel, PowerPoint"
    />

    <UiCard titel="Collabora Online" icon="file-word">
      <p class="mb-4 text-sm text-ink-muted">
        PDF und Bilder zeigt SARU selbst. Für Office-Dateien kann ein Collabora-Server
        angebunden werden.
      </p>
      <label class="mb-4 flex items-center gap-2 text-sm">
        <input v-model="collabora.enabled" type="checkbox" class="accent-[var(--color-primary)]">
        Office-Editor aktivieren
      </label>
      <div class="grid gap-4">
        <UiField
          label="Collabora-Adresse"
          hinweis="Öffentliche URL des Collabora-Servers."
        >
          <UiInput
            v-model="collabora.baseUrl"
            placeholder="https://office.example"
            :disabled="!collabora.enabled"
          />
        </UiField>
        <UiField
          label="SARU-Adresse für Collabora"
          hinweis="Nur nötig, wenn Collabora SARU unter einer anderen URL erreichen muss."
        >
          <UiInput
            v-model="collabora.wopiHostUrl"
            placeholder="https://saru.example"
            :disabled="!collabora.enabled"
          />
        </UiField>
      </div>
      <p
        v-if="collabora.enabled && collabora.baseUrl.startsWith('https://')"
        class="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-ink"
      >
        Selbstsigniertes Zertifikat einmal unter
        <a
          :href="collaboraOrigin"
          target="_blank"
          rel="noopener"
          class="font-medium text-primary underline"
        >{{ collaboraOrigin }}</a>
        akzeptieren, sonst bleibt die Vorschau leer.
      </p>
      <div class="mt-4 flex justify-end">
        <UiButton variante="primaer" icon="floppy-disk" :laedt="laeuft" @click="speichern">
          Speichern
        </UiButton>
      </div>
    </UiCard>
  </LayoutEinstellungsSeite>
</template>
