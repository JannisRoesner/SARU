<script setup lang="ts">
useHead({ title: 'Uploads & Datenschutz' })

const { istAdmin } = useSitzung()
if (!istAdmin.value) await navigateTo('/einstellungen')

const { aufruf, laeuft } = useApi()

const { data, refresh } = await useFetch<{
  uploads: {
    maxBytes: number
    maxImportBytes: number
    allowedExtensions: string[]
    scanArchives: boolean
  }
  privacy: {
    auditRetentionDays: number
    aiJobRetentionDays: number
    storeAiPrompts: boolean
    searchHistoryRetentionDays: number
  }
}>('/api/settings')

const uploads = reactive({
  maxBytes: 100 * 1024 * 1024,
  maxImportBytes: 500 * 1024 * 1024,
  allowedExtensions: '' as string,
  scanArchives: true,
})

const privacy = reactive({
  auditRetentionDays: 365,
  aiJobRetentionDays: 90,
  storeAiPrompts: false,
  searchHistoryRetentionDays: 90,
})

watch(
  data,
  (wert) => {
    if (!wert) return
    uploads.maxBytes = wert.uploads.maxBytes
    uploads.maxImportBytes = wert.uploads.maxImportBytes
    uploads.allowedExtensions = wert.uploads.allowedExtensions.join(', ')
    uploads.scanArchives = wert.uploads.scanArchives
    Object.assign(privacy, wert.privacy)
  },
  { immediate: true },
)

async function uploadsSpeichern() {
  await aufruf('/api/settings/uploads', {
    method: 'PATCH',
    body: {
      maxBytes: Number(uploads.maxBytes),
      maxImportBytes: Number(uploads.maxImportBytes),
      allowedExtensions: uploads.allowedExtensions
        .split(/[,;\s]+/)
        .map((e) => e.replace(/^\./, '').toLowerCase())
        .filter(Boolean),
      scanArchives: uploads.scanArchives,
    },
    erfolgsmeldung: 'Upload-Einstellungen gespeichert.',
  })
  await refresh()
}

async function privacySpeichern() {
  await aufruf('/api/settings/privacy', {
    method: 'PATCH',
    body: privacy,
    erfolgsmeldung: 'Datenschutz-Einstellungen gespeichert.',
  })
  await refresh()
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5">
    <div class="mb-2">
      <NuxtLink to="/einstellungen" class="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary">
        <UiIcon name="arrow-left" fest /> Einstellungen
      </NuxtLink>
    </div>

    <LayoutSeitenkopf
      kicker="System"
      titel="Uploads & Datenschutz"
      untertitel="Grenzen für Dateien und Aufbewahrungsfristen für Protokolle."
    />

    <UiCard titel="Uploads" icon="cloud-arrow-up">
      <div class="grid gap-4 sm:grid-cols-2">
        <UiField label="Max. Dateigröße (Bytes)">
          <UiInput v-model="uploads.maxBytes" type="number" />
          <p class="mt-1 text-xs text-ink-subtle">≈ {{ formatBytes(Number(uploads.maxBytes)) }}</p>
        </UiField>
        <UiField label="Max. Importgröße (Bytes)">
          <UiInput v-model="uploads.maxImportBytes" type="number" />
          <p class="mt-1 text-xs text-ink-subtle">≈ {{ formatBytes(Number(uploads.maxImportBytes)) }}</p>
        </UiField>
        <UiField label="Erlaubte Endungen" class="sm:col-span-2" hinweis="Kommagetrennt, ohne Punkt">
          <UiInput v-model="uploads.allowedExtensions" />
        </UiField>
      </div>
      <label class="mt-4 flex items-center gap-2 text-sm">
        <input v-model="uploads.scanArchives" type="checkbox" class="accent-[var(--color-primary)]">
        Archive beim Import prüfen
      </label>
      <div class="mt-4 flex justify-end">
        <UiButton variante="primaer" icon="floppy-disk" :laedt="laeuft" @click="uploadsSpeichern">
          Speichern
        </UiButton>
      </div>
    </UiCard>

    <UiCard titel="Datenschutz" icon="shield-halved">
      <div class="grid gap-4 sm:grid-cols-2">
        <UiField label="Audit-Aufbewahrung (Tage)">
          <UiInput v-model="privacy.auditRetentionDays" type="number" min="0" />
        </UiField>
        <UiField label="KI-Jobs (Tage)">
          <UiInput v-model="privacy.aiJobRetentionDays" type="number" min="0" />
        </UiField>
        <UiField label="Suchverlauf (Tage)">
          <UiInput v-model="privacy.searchHistoryRetentionDays" type="number" min="0" />
        </UiField>
      </div>
      <label class="mt-4 flex items-center gap-2 text-sm">
        <input v-model="privacy.storeAiPrompts" type="checkbox" class="accent-[var(--color-primary)]">
        KI-Prompts speichern (für Nachvollziehbarkeit)
      </label>
      <div class="mt-4 flex justify-end">
        <UiButton variante="primaer" icon="floppy-disk" :laedt="laeuft" @click="privacySpeichern">
          Speichern
        </UiButton>
      </div>
    </UiCard>
  </div>
</template>
