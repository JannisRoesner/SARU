<script setup lang="ts">
import type { AiProvider } from '#shared/types/domain'
import { OLLAMA_EMBEDDING_MODEL } from '#shared/utils/embeddings'
import { aiProviders } from '#shared/utils/labels'
import type { KombiOption } from '~/components/ui/Kombifeld.vue'

useHead({ title: 'KI-Anbindung' })

const { istAdmin } = useSitzung()
if (!istAdmin.value) await navigateTo('/einstellungen')

const { aufruf, laeuft } = useApi()

type ProviderId = AiProvider

const STANDARD_URLS: Record<ProviderId, string> = {
  openai: 'https://api.openai.com/v1',
  ollama: 'http://localhost:11434/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  openai_kompatibel: 'http://localhost:8080/v1',
}

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
    vectorOnlySearch: boolean
    embeddingModelEffektiv?: string
    embeddingModelWarnung?: string | null
    temperature: number
    maxOutputTokens: number
    timeoutMs: number
    refererUrl: string
    appTitle: string
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
  vectorOnlySearch: false,
  temperature: 0.2,
  maxOutputTokens: 4096,
  timeoutMs: 180000,
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

interface IndexStatus {
  documents: number
  embedded: number
  pending: number
  outdated: number
  models: string[]
  currentModel: string | null
  job: { running: boolean; error: string | null }
}

const { data: indexStatus, refresh: indexStatusLaden } =
  await useFetch<IndexStatus>('/api/search/index-status')

const fortschritt = computed(() => {
  const status = indexStatus.value
  if (!status || status.documents === 0) return 0
  return Math.round((status.embedded / status.documents) * 100)
})

const andereModelle = computed(() =>
  (indexStatus.value?.models ?? []).filter((m) => m !== indexStatus.value?.currentModel),
)

// Solange der Hintergrundlauf arbeitet, den Stand regelmäßig nachladen.
let indexTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  indexTimer = setInterval(() => {
    if (indexStatus.value?.job.running) void indexStatusLaden()
  }, 2000)
})
onBeforeUnmount(() => {
  if (indexTimer) clearInterval(indexTimer)
})

async function embeddingsBerechnen(alle: boolean) {
  const status = await aufruf<IndexStatus>(`/api/search/embeddings${alle ? '?alle=1' : ''}`, {
    method: 'POST',
    erfolgsmeldung: 'Berechnung der Vektoren gestartet.',
  })
  if (status) indexStatus.value = status
}

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
  if (formular.provider === 'openai_kompatibel') {
    return {
      chat: 'aus der Liste wählen',
      vision: 'aus der Liste wählen',
      embedding: 'aus der Liste wählen',
      text: 'Für llama.cpp (llama-server), LM Studio, vLLM und andere Server mit OpenAI-Schnittstelle. Arbeitsblätter werden als Seitenbilder übergeben – für Musterlösungen ein multimodales Modell wählen (bei llama.cpp mit --mmproj gestartet).',
      embeddingHinweis: 'Ein Embedding-Modell des Servers, z. B. qwen3-embedding. Nach einem Wechsel die Vektoren neu berechnen.',
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
  // Leere Empfehlungen (OpenAI-kompatibel) überschreiben nichts – dort gibt der Server die Namen vor.
  if (hints.chatModel) formular.chatModel = hints.chatModel
  if (hints.visionModel) formular.visionModel = hints.visionModel
  if (hints.embeddingModel) formular.embeddingModel = hints.embeddingModel
  formular.useVision = hints.useVision
  if (!formular.baseUrl.trim()) formular.baseUrl = STANDARD_URLS[formular.provider]
}

// --- Modelllisten -------------------------------------------------------------

interface ModellInfo {
  id: string
  aliase: string[]
  bild: boolean | null
  embedding: boolean | null
}

const modelle = ref<ModellInfo[]>([])
const modellWarnung = ref<string | null>(null)
const modellFehler = ref<string | null>(null)
const modelleLaden = ref(false)
let ladeNummer = 0

async function modelleAbrufen() {
  const nummer = ++ladeNummer
  modelleLaden.value = true
  modellFehler.value = null
  try {
    const body: Record<string, unknown> = { provider: formular.provider, baseUrl: formular.baseUrl }
    if (formular.apiKey.trim()) body.apiKey = formular.apiKey
    // Schlichter Funktionstyp – siehe useApi (Routentypen werden sonst zu tief).
    const holen = $fetch as unknown as (
      url: string,
      opts: object,
    ) => Promise<{ modelle: ModellInfo[]; warnung: string | null }>
    const ergebnis = await holen('/api/settings/ai-models', { method: 'POST', body })
    if (nummer !== ladeNummer) return
    modelle.value = ergebnis.modelle
    modellWarnung.value = ergebnis.warnung
  } catch (error) {
    if (nummer !== ladeNummer) return
    modelle.value = []
    modellWarnung.value = null
    modellFehler.value = toApiFehler(error).nachricht
  } finally {
    if (nummer === ladeNummer) modelleLaden.value = false
  }
}

// Anbieter oder Adresse geändert: Liste mit kurzer Verzögerung neu laden.
let ladeTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => [formular.provider, formular.baseUrl] as const,
  () => {
    if (ladeTimer) clearTimeout(ladeTimer)
    ladeTimer = setTimeout(() => void modelleAbrufen(), 600)
  },
)
onMounted(() => void modelleAbrufen())
onBeforeUnmount(() => {
  if (ladeTimer) clearTimeout(ladeTimer)
})

function alsOption(modell: ModellInfo, nachrangig: boolean): KombiOption {
  const zusaetze = modell.aliase.slice(0, 1)
  if (modell.bild) zusaetze.push('Bild')
  if (modell.embedding) zusaetze.push('Embedding')
  return { wert: modell.id, zusaetze, gleichwertig: modell.aliase, nachrangig }
}

const chatOptionen = computed(() => modelle.value.map((m) => alsOption(m, m.embedding === true)))
const visionOptionen = computed(() =>
  modelle.value.map((m) => alsOption(m, m.embedding === true || m.bild === false)),
)
const embeddingOptionen = computed(() => {
  // Erkennt der Server keine Embedding-Modelle, bleiben alle gleichrangig.
  const bekannt = modelle.value.some((m) => m.embedding === true)
  return modelle.value.map((m) => alsOption(m, bekannt && m.embedding !== true))
})

/** Steht der eingetragene Name (oder ein Alias) nicht in der Liste des Servers? */
function fehltAufServer(name: string): boolean {
  const n = name.trim()
  if (!n || !modelle.value.length) return false
  return !modelle.value.some((m) => m.id === n || m.aliase.includes(n))
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
  await indexStatusLaden()
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
    void modelleAbrufen()
  } catch (error) {
    testErgebnis.value = (error as { nachricht?: string }).nachricht ?? 'Test fehlgeschlagen.'
  }
}
</script>

<template>
  <LayoutEinstellungsSeite>
    <LayoutSeitenkopf
      zurueck-to="/einstellungen"
      zurueck-label="Einstellungen"
      kicker="System"
      titel="KI-Anbindung"
      untertitel="Modelle und Funktionen"
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
              :placeholder="STANDARD_URLS[formular.provider]"
            />
          </UiField>
          <UiField
            label="API-Schlüssel"
            :hinweis="data?.ai.apiKeyGesetzt ? 'Gesetzt – leer lassen, um beizubehalten.' : undefined"
            class="sm:col-span-2"
          >
            <UiInput v-model="formular.apiKey" type="password" autocomplete="off" placeholder="••••••••" />
          </UiField>
          <div class="flex flex-wrap items-center gap-2 text-xs sm:col-span-2">
            <span v-if="modelleLaden" class="text-ink-subtle">Modelle werden geladen …</span>
            <span v-else-if="modellFehler" class="text-danger">Modellliste nicht verfügbar: {{ modellFehler }}</span>
            <span v-else class="text-ink-subtle">
              {{
                modelle.length
                  ? `${modelle.length} Modelle auf dem Server – Felder aufklappen oder Namen eintippen.`
                  : 'Der Server meldet keine Modelle.'
              }}
            </span>
            <button type="button" class="text-primary hover:underline" @click="modelleAbrufen">Neu laden</button>
          </div>
          <p
            v-if="modellWarnung"
            class="sm:col-span-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-ink-muted"
          >
            {{ modellWarnung }}
            <button
              type="button"
              class="ml-1 font-medium text-primary hover:underline"
              @click="formular.provider = 'openai_kompatibel'"
            >
              Jetzt umstellen
            </button>
          </p>
          <UiField
            label="Chat-Modell"
            :hinweis="fehltAufServer(formular.chatModel) ? 'Dieser Name steht nicht in der Liste des Servers.' : `Empfehlung: ${hinweise.chat}`"
          >
            <UiKombifeld
              v-model="formular.chatModel"
              :optionen="chatOptionen"
              :laedt="modelleLaden"
              :placeholder="hinweise.chat"
            />
          </UiField>
          <UiField
            label="Vision-Modell"
            :hinweis="fehltAufServer(formular.visionModel) ? 'Dieser Name steht nicht in der Liste des Servers.' : 'Für Arbeitsblätter/PDFs – muss Bilder verarbeiten können.'"
          >
            <UiKombifeld
              v-model="formular.visionModel"
              :optionen="visionOptionen"
              :laedt="modelleLaden"
              :placeholder="hinweise.vision"
            />
          </UiField>
          <UiField
            label="Embedding-Modell"
            :hinweis="fehltAufServer(formular.embeddingModel) ? 'Dieser Name steht nicht in der Liste des Servers.' : hinweise.embeddingHinweis"
          >
            <UiKombifeld
              v-model="formular.embeddingModel"
              :optionen="embeddingOptionen"
              :laedt="modelleLaden"
              :placeholder="hinweise.embedding"
            />
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
          <label class="flex items-center gap-2" :class="{ 'opacity-50': !formular.embeddingsEnabled }">
            <input
              v-model="formular.vectorOnlySearch"
              type="checkbox"
              class="accent-[var(--color-primary)]"
              :disabled="!formular.embeddingsEnabled"
            >
            Nur Vektorsuche (ohne Volltext)
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

    <UiCard v-if="indexStatus" titel="Vektorsuche" icon="magnifying-glass">
      <div class="space-y-4 text-sm">
        <p v-if="!indexStatus.currentModel" class="rounded-lg bg-surface-sunken px-3 py-2 text-ink-muted">
          Die Vektorsuche ist ausgeschaltet. Die Volltextsuche funktioniert unabhängig davon.
        </p>

        <template v-else>
          <div>
            <div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
              <span>
                Aktuelles Modell: <strong>{{ indexStatus.currentModel }}</strong>
              </span>
              <span class="text-ink-muted">
                {{ indexStatus.embedded }} von {{ indexStatus.documents }} Abschnitten berechnet
              </span>
            </div>
            <div
              class="h-2 overflow-hidden rounded-full bg-surface-sunken"
              role="progressbar"
              :aria-valuenow="fortschritt"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <div
                class="h-full rounded-full bg-[var(--color-primary)] transition-all"
                :style="{ width: `${fortschritt}%` }"
              />
            </div>
          </div>

          <p v-if="indexStatus.job.running" class="text-ink-muted">
            Vektoren werden im Hintergrund berechnet … Du kannst die Seite verlassen.
          </p>
          <p
            v-else-if="indexStatus.job.error"
            class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-ink-muted"
          >
            Die Berechnung wurde abgebrochen: {{ indexStatus.job.error }}
          </p>
          <p v-else-if="indexStatus.pending === 0" class="text-ink-muted">
            Alles aktuell – die semantische Suche nutzt alle Abschnitte.
          </p>

          <p
            v-if="indexStatus.pending > 0 && !indexStatus.job.running"
            class="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-ink-muted"
          >
            {{ indexStatus.pending }} Abschnitte haben noch keinen Vektor des aktuellen Modells
            <template v-if="andereModelle.length">
              (vorhanden: {{ andereModelle.join(', ') }})
            </template>.
            Sie werden in der semantischen Suche übergangen, bis sie neu berechnet sind.
          </p>

          <div class="flex flex-wrap justify-end gap-2">
            <UiButton
              variante="sekundaer"
              icon="arrows-rotate"
              :disabled="indexStatus.job.running"
              @click="embeddingsBerechnen(true)"
            >
              Alle neu berechnen
            </UiButton>
            <UiButton
              v-if="indexStatus.pending > 0 || indexStatus.job.error"
              variante="primaer"
              icon="play"
              :disabled="indexStatus.job.running"
              @click="embeddingsBerechnen(false)"
            >
              {{ indexStatus.job.error ? 'Erneut versuchen' : 'Fehlende berechnen' }}
            </UiButton>
          </div>
        </template>
      </div>
    </UiCard>
  </LayoutEinstellungsSeite>
</template>
