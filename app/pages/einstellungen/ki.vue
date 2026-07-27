<script setup lang="ts">
import { OLLAMA_EMBEDDING_MODEL } from '#shared/utils/embeddings'
import { aiProviders } from '#shared/utils/labels'

useHead({ title: 'KI-Anbindung' })

const { istAdmin } = useSitzung()
if (!istAdmin.value) await navigateTo('/einstellungen')

const { aufruf, laeuft } = useApi()

type ProviderId = 'openai' | 'ollama' | 'openrouter'

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
    embeddingModelEffektiv?: string
    embeddingModelWarnung?: string | null
    temperature: number
    maxOutputTokens: number
    timeoutMs: number
    refererUrl: string
    appTitle: string
  }
  hermes: {
    enabled: boolean
    baseUrl: string
    apiKey: string
    apiKeyGesetzt: boolean
    timeoutMs: number
  }
  modelHints: Record<
    ProviderId,
    { chatModel: string; visionModel: string; embeddingModel: string; useVision: boolean }
  >
}>('/api/settings')

const formular = reactive({
  enabled: false,
  provider: 'ollama' as ProviderId,
  baseUrl: '',
  apiKey: '',
  chatModel: '',
  visionModel: '',
  useVision: true,
  embeddingsEnabled: false,
  embeddingModel: '',
  temperature: 0.2,
  maxOutputTokens: 4096,
  timeoutMs: 180000,
  refererUrl: '',
  appTitle: 'SARU',
})

const hermes = reactive({
  enabled: false,
  baseUrl: '',
  apiKey: '',
  timeoutMs: 300000,
})

watch(
  data,
  (wert) => {
    if (!wert?.ai) return
    Object.assign(formular, {
      ...wert.ai,
      apiKey: '',
    })
    if (wert.hermes) {
      Object.assign(hermes, {
        enabled: wert.hermes.enabled,
        baseUrl: wert.hermes.baseUrl,
        apiKey: '',
        timeoutMs: wert.hermes.timeoutMs,
      })
    }
  },
  { immediate: true },
)

const testErgebnis = ref<string | null>(null)
const hermesTestErgebnis = ref<string | null>(null)

const hinweise = computed(() => {
  const hints = data.value?.modelHints?.[formular.provider as ProviderId]
  if (formular.provider === 'ollama') {
    return {
      chat: hints?.chatModel ?? 'gemma4:e4b-it-qat',
      vision: hints?.visionModel ?? 'gemma4:e4b-it-qat',
      embedding: hints?.embeddingModel ?? OLLAMA_EMBEDDING_MODEL,
      text: 'Für Musterlösungen multimodale Modelle empfohlen (Vision + Text), z. B. gemma4:e4b-it-qat. PDFs werden als Seitenbilder ausgewertet; Lösungen erscheinen als Text-Overlay auf den Originalseiten.',
      embeddingHinweis:
        `Für die Vektorsuche z. B. ${OLLAMA_EMBEDDING_MODEL} (ollama pull ${OLLAMA_EMBEDDING_MODEL}). OpenAI-Modelle wie text-embedding-3-small funktionieren bei Ollama nicht.`,
    }
  }
  if (formular.provider === 'openai') {
    return {
      chat: hints?.chatModel ?? 'gpt-4o-mini',
      vision: hints?.visionModel ?? 'gpt-4o-mini',
      embedding: hints?.embeddingModel ?? 'text-embedding-3-small',
      text: 'Vision-fähige Modelle können Arbeitsblätter und PDFs direkt auswerten.',
      embeddingHinweis: 'OpenAI-Embeddings, z. B. text-embedding-3-small.',
    }
  }
  return {
    chat: hints?.chatModel ?? 'openai/gpt-4o-mini',
    vision: hints?.visionModel ?? 'openai/gpt-4o-mini',
    embedding: hints?.embeddingModel ?? 'openai/text-embedding-3-small',
    text: 'OpenRouter: multimodales Modell wählen, das Bilder/PDFs unterstützt.',
    embeddingHinweis: 'OpenRouter-Präfix verwenden, z. B. openai/text-embedding-3-small.',
  }
})

function anbieterHinweiseUebernehmen() {
  const hints = data.value?.modelHints?.[formular.provider as ProviderId]
  if (!hints) return
  formular.chatModel = hints.chatModel
  formular.visionModel = hints.visionModel
  formular.embeddingModel = hints.embeddingModel
  formular.useVision = hints.useVision
  if (!formular.baseUrl.trim()) {
    if (formular.provider === 'ollama') formular.baseUrl = 'http://localhost:11434/v1'
    if (formular.provider === 'openai') formular.baseUrl = 'https://api.openai.com/v1'
    if (formular.provider === 'openrouter') formular.baseUrl = 'https://openrouter.ai/api/v1'
  }
}

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

async function hermesSpeichern() {
  const body: Record<string, unknown> = { ...hermes }
  if (!hermes.apiKey.trim()) delete body.apiKey
  await aufruf('/api/settings/hermes', {
    method: 'PATCH',
    body,
    erfolgsmeldung: 'Hermes-Einstellungen gespeichert.',
  })
  await refresh()
}

async function hermesTesten() {
  hermesTestErgebnis.value = null
  const body: Record<string, unknown> = { ...hermes }
  if (!hermes.apiKey.trim()) delete body.apiKey
  try {
    const ergebnis = await aufruf<{ ok?: boolean; message?: string }>(
      '/api/settings/hermes-test',
      { method: 'POST', body, stumm: true },
    )
    hermesTestErgebnis.value = ergebnis?.message ?? 'Verbindung erfolgreich.'
  } catch (error) {
    hermesTestErgebnis.value =
      (error as { nachricht?: string }).nachricht ?? 'Test fehlgeschlagen.'
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6">
    <LayoutSeitenkopf
      zurueck-to="/einstellungen"
      zurueck-label="Einstellungen"
      kicker="System"
      titel="KI-Anbindung"
      untertitel="Musterlösungen erzeugen, multimodale Modelle anbinden und optional Hermes nutzen. API-Schlüssel werden serverseitig verschlüsselt gespeichert."
    />

    <UiCard titel="Anbieter" icon="wand-magic-sparkles">
      <div class="space-y-4">
        <label class="flex items-center gap-2 text-sm">
          <input v-model="formular.enabled" type="checkbox" class="accent-[var(--color-primary)]">
          KI-Funktionen aktivieren
        </label>

        <p class="rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
          {{ hinweise.text }}
        </p>

        <div class="grid gap-4 sm:grid-cols-2">
          <UiField label="Anbieter">
            <UiSelect
              v-model="formular.provider"
              :optionen="aiProviders.options().map((o) => ({ value: o.value, label: o.label }))"
            />
          </UiField>
          <UiField label="Basis-URL">
            <UiInput
              v-model="formular.baseUrl"
              :placeholder="formular.provider === 'ollama' ? 'http://localhost:11434/v1' : 'https://api.openai.com/v1'"
            />
          </UiField>
          <UiField
            label="API-Schlüssel"
            :hinweis="data?.ai.apiKeyGesetzt ? 'Gesetzt – leer lassen, um beizubehalten.' : undefined"
            class="sm:col-span-2"
          >
            <UiInput v-model="formular.apiKey" type="password" autocomplete="off" placeholder="••••••••" />
          </UiField>
          <UiField label="Chat-Modell" :hinweis="`Empfehlung: ${hinweise.chat}`">
            <UiInput v-model="formular.chatModel" :placeholder="hinweise.chat" />
          </UiField>
          <UiField
            label="Vision-Modell"
            hinweis="Für Arbeitsblätter/PDFs – bei Ollama z. B. gemma4:e4b-it-qat"
          >
            <UiInput v-model="formular.visionModel" :placeholder="hinweise.vision" />
          </UiField>
          <UiField
            label="Embedding-Modell"
            :hinweis="hinweise.embeddingHinweis"
          >
            <UiInput v-model="formular.embeddingModel" :placeholder="hinweise.embedding" />
          </UiField>
          <p
            v-if="data?.ai.embeddingModelWarnung"
            class="sm:col-span-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-ink-muted"
          >
            {{ data.ai.embeddingModelWarnung }}
            <span v-if="data.ai.embeddingModelEffektiv && data.ai.embeddingModelEffektiv !== formular.embeddingModel">
              Bis zum Speichern wird intern vorläufig „{{ data.ai.embeddingModelEffektiv }}“ verwendet.
            </span>
          </p>
          <UiField label="Temperatur">
            <UiInput v-model="formular.temperature" type="number" min="0" max="2" step="0.1" />
          </UiField>
          <UiField label="Timeout (ms)" hinweis="Vision-Läufe brauchen oft länger">
            <UiInput v-model="formular.timeoutMs" type="number" min="5000" step="1000" />
          </UiField>
        </div>

        <div class="flex flex-wrap gap-4 text-sm">
          <label class="flex items-center gap-2">
            <input v-model="formular.useVision" type="checkbox" class="accent-[var(--color-primary)]">
            Vision nutzen (Seitenbilder / multimodale Auswertung)
          </label>
          <label class="flex items-center gap-2">
            <input v-model="formular.embeddingsEnabled" type="checkbox" class="accent-[var(--color-primary)]">
            Embeddings / Vektorsuche
          </label>
        </div>

        <p v-if="testErgebnis" class="rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
          {{ testErgebnis }}
        </p>

        <div class="flex flex-wrap justify-end gap-2">
          <UiButton variante="sekundaer" icon="lightbulb" @click="anbieterHinweiseUebernehmen">
            Empfehlungen übernehmen
          </UiButton>
          <UiButton variante="sekundaer" icon="flask" :laedt="laeuft" @click="testen">
            Verbindung testen
          </UiButton>
          <UiButton variante="primaer" icon="floppy-disk" :laedt="laeuft" @click="speichern">
            Speichern
          </UiButton>
        </div>
      </div>
    </UiCard>

    <UiCard titel="Hermes-Agent (optional)" icon="robot">
      <div class="space-y-4">
        <p class="text-sm text-ink-muted">
          Optionaler Agent-Container für die Dokumentfüllung. SARU ruft
          <code class="rounded bg-surface-sunken px-1 py-0.5">POST /v1/document-fill</code>
          auf (JSON mit Datei + Anweisung → ausgefülltes Dokument). Fehlt der Endpunkt, greift der
          lokale Multimodal-/Dokument-Pfad. OpenAI-kompatible Hermes-APIs
          (<code class="rounded bg-surface-sunken px-1 py-0.5">/v1/chat/completions</code>) bleiben unberührt.
        </p>

        <label class="flex items-center gap-2 text-sm">
          <input v-model="hermes.enabled" type="checkbox" class="accent-[var(--color-primary)]">
          Hermes-Agent aktivieren
        </label>

        <div class="grid gap-4 sm:grid-cols-2">
          <UiField
            label="Basis-URL"
            hinweis="z. B. http://localhost:8642"
            class="sm:col-span-2"
          >
            <UiInput
              v-model="hermes.baseUrl"
              placeholder="http://localhost:8642"
              :disabled="!hermes.enabled"
            />
          </UiField>
          <UiField
            label="API-Schlüssel"
            :hinweis="data?.hermes?.apiKeyGesetzt ? 'Gesetzt – leer lassen, um beizubehalten.' : 'Optional, falls der Container Auth verlangt'"
          >
            <UiInput
              v-model="hermes.apiKey"
              type="password"
              autocomplete="off"
              placeholder="••••••••"
              :disabled="!hermes.enabled"
            />
          </UiField>
          <UiField label="Timeout (ms)">
            <UiInput
              v-model="hermes.timeoutMs"
              type="number"
              min="5000"
              step="1000"
              :disabled="!hermes.enabled"
            />
          </UiField>
        </div>

        <p v-if="hermesTestErgebnis" class="rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
          {{ hermesTestErgebnis }}
        </p>

        <div class="flex justify-end gap-2">
          <UiButton
            variante="sekundaer"
            icon="flask"
            :laedt="laeuft"
            :disabled="!hermes.enabled"
            @click="hermesTesten"
          >
            Verbindung testen
          </UiButton>
          <UiButton variante="primaer" icon="floppy-disk" :laedt="laeuft" @click="hermesSpeichern">
            Speichern
          </UiButton>
        </div>
      </div>
    </UiCard>
  </div>
</template>
