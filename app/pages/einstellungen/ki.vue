<script setup lang="ts">
import { aiProviders } from '#shared/utils/labels'

useHead({ title: 'KI-Anbindung' })

const { istAdmin } = useSitzung()
if (!istAdmin.value) await navigateTo('/einstellungen')

const { aufruf, laeuft } = useApi()

const { data, refresh } = await useFetch<{
  ai: {
    enabled: boolean
    provider: string
    baseUrl: string
    apiKey: string
    apiKeyGesetzt: boolean
    chatModel: string
    visionModel: string
    useVision: boolean
    embeddingsEnabled: boolean
    embeddingModel: string
    temperature: number
    maxOutputTokens: number
    timeoutMs: number
    refererUrl: string
    appTitle: string
  }
}>('/api/settings')

const formular = reactive({
  enabled: false,
  provider: 'openai',
  baseUrl: '',
  apiKey: '',
  chatModel: '',
  visionModel: '',
  useVision: false,
  embeddingsEnabled: false,
  embeddingModel: '',
  temperature: 0.2,
  maxOutputTokens: 4096,
  timeoutMs: 120000,
  refererUrl: '',
  appTitle: 'SARU',
})

watch(
  data,
  (wert) => {
    if (!wert?.ai) return
    Object.assign(formular, {
      ...wert.ai,
      apiKey: '',
    })
  },
  { immediate: true },
)

const testErgebnis = ref<string | null>(null)

async function speichern() {
  const body: Record<string, unknown> = { ...formular }
  if (!formular.apiKey.trim()) delete body.apiKey
  await aufruf('/api/settings/ai', {
    method: 'PATCH',
    body,
    erfolgsmeldung: 'KI-Einstellungen gespeichert.',
  })
  await refresh()
}

async function testen() {
  testErgebnis.value = null
  const body: Record<string, unknown> = { ...formular }
  if (!formular.apiKey.trim()) delete body.apiKey
  try {
    const ergebnis = await aufruf<{ ok?: boolean; message?: string; modell?: string }>(
      '/api/settings/ai-test',
      { method: 'POST', body, stumm: true },
    )
    testErgebnis.value = ergebnis?.message ?? 'Verbindung erfolgreich.'
  } catch (error) {
    testErgebnis.value = (error as { nachricht?: string }).nachricht ?? 'Test fehlgeschlagen.'
  }
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
      kicker="System"
      titel="KI-Anbindung"
      untertitel="Optional für Musterlösungen und semantische Suche. Der API-Schlüssel verlässt den Server nie im Klartext."
    />

    <UiCard titel="Anbieter" icon="wand-magic-sparkles">
      <div class="space-y-4">
        <label class="flex items-center gap-2 text-sm">
          <input v-model="formular.enabled" type="checkbox" class="accent-[var(--color-primary)]">
          KI-Funktionen aktivieren
        </label>

        <div class="grid gap-4 sm:grid-cols-2">
          <UiField label="Anbieter">
            <UiSelect
              v-model="formular.provider"
              :optionen="aiProviders.options().map((o) => ({ value: o.value, label: o.label }))"
            />
          </UiField>
          <UiField label="Basis-URL">
            <UiInput v-model="formular.baseUrl" placeholder="https://api.openai.com/v1" />
          </UiField>
          <UiField
            label="API-Schlüssel"
            :hinweis="data?.ai.apiKeyGesetzt ? 'Gesetzt – leer lassen, um beizubehalten.' : undefined"
            class="sm:col-span-2"
          >
            <UiInput v-model="formular.apiKey" type="password" autocomplete="off" placeholder="••••••••" />
          </UiField>
          <UiField label="Chat-Modell">
            <UiInput v-model="formular.chatModel" placeholder="gpt-4o-mini" />
          </UiField>
          <UiField label="Vision-Modell">
            <UiInput v-model="formular.visionModel" />
          </UiField>
          <UiField label="Embedding-Modell">
            <UiInput v-model="formular.embeddingModel" />
          </UiField>
          <UiField label="Temperatur">
            <UiInput v-model="formular.temperature" type="number" min="0" max="2" step="0.1" />
          </UiField>
        </div>

        <div class="flex flex-wrap gap-4 text-sm">
          <label class="flex items-center gap-2">
            <input v-model="formular.useVision" type="checkbox" class="accent-[var(--color-primary)]">
            Vision nutzen
          </label>
          <label class="flex items-center gap-2">
            <input v-model="formular.embeddingsEnabled" type="checkbox" class="accent-[var(--color-primary)]">
            Embeddings / Vektorsuche
          </label>
        </div>

        <p v-if="testErgebnis" class="rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
          {{ testErgebnis }}
        </p>

        <div class="flex justify-end gap-2">
          <UiButton variante="sekundaer" icon="flask" :laedt="laeuft" @click="testen">
            Verbindung testen
          </UiButton>
          <UiButton variante="primaer" icon="floppy-disk" :laedt="laeuft" @click="speichern">
            Speichern
          </UiButton>
        </div>
      </div>
    </UiCard>
  </div>
</template>
