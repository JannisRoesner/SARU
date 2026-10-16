<script setup lang="ts">
import { AI_ROLLEN, type AiProvider, type AiRolle, type AiRollenAnbieterId } from '#shared/types/domain'
import { OLLAMA_EMBEDDING_MODEL, supportsImageEmbeddings } from '#shared/utils/embeddings'
import { aiProviders } from '#shared/utils/labels'
import type { KombiOption } from '~/components/ui/Kombifeld.vue'

useHead({ title: 'KI-Anbindung' })

const { istAdmin } = useSitzung()
if (!istAdmin.value) await navigateTo('/einstellungen')

const { aufruf, laeuft } = useApi()

type ProviderId = AiProvider
/** Quelle einer Modellliste: der Standardanbieter oder der eigene Anbieter einer Aufgabe. */
type Quelle = 'standard' | AiRolle

const STANDARD_URLS: Record<ProviderId, string> = {
  openai: 'https://api.openai.com/v1',
  ollama: 'http://localhost:11434/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  openai_kompatibel: 'http://localhost:8080/v1',
}

/** Anbieter, die Inhalte an einen Dienst im Internet schicken. */
const EXTERNE_ANBIETER: ProviderId[] = ['openai', 'openrouter']

interface RollenAnbieter {
  provider: AiRollenAnbieterId
  baseUrl: string
  apiKey: string
  apiKeyGesetzt?: boolean
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
    embedImages: boolean
    embeddingModelEffektiv?: string
    embeddingModelWarnung?: string | null
    embeddingVerbindung?: { provider: ProviderId; baseUrl: string }
    embeddingDimensionen?: number
    temperature: number
    maxOutputTokens: number
    timeoutMs: number
    denkmodusMusterloesungen?: boolean
    denkBudget?: number
    refererUrl: string
    appTitle: string
    rollen?: Record<AiRolle, RollenAnbieter>
  }
  modelHints: Record<
    ProviderId,
    { chatModel: string; visionModel: string; embeddingModel: string; useVision: boolean }
  >
}>('/api/settings')

function standardRolle(): RollenAnbieter {
  return { provider: 'standard', baseUrl: '', apiKey: '' }
}

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
  embedImages: false,
  temperature: 0.2,
  maxOutputTokens: 4096,
  timeoutMs: 180000,
  denkmodusMusterloesungen: false,
  denkBudget: 4000,
  refererUrl: '',
  appTitle: 'SARU',
  rollen: { chat: standardRolle(), vision: standardRolle(), embedding: standardRolle() } as Record<
    AiRolle,
    RollenAnbieter
  >,
})

watch(
  data,
  (wert) => {
    if (!wert?.ai) return
    const { rollen, ...rest } = wert.ai
    Object.assign(formular, { ...rest, apiKey: '' })
    for (const rolle of AI_ROLLEN) {
      const gespeichert = rollen?.[rolle]
      formular.rollen[rolle] = {
        provider: gespeichert?.provider ?? 'standard',
        // Die Standard-URL zeigt das Feld als Platzhalter.
        baseUrl:
          gespeichert && gespeichert.provider !== 'standard' && gespeichert.baseUrl !== STANDARD_URLS[gespeichert.provider]
            ? gespeichert.baseUrl
            : '',
        apiKey: '',
        apiKeyGesetzt: gespeichert?.apiKeyGesetzt ?? false,
      }
    }
  },
  { immediate: true },
)

// --- Aufgaben ---------------------------------------------------------------

const ROLLEN_INFO: Record<AiRolle, { titel: string; beschreibung: string; modellLabel: string; icon: string }> = {
  chat: {
    titel: 'Texte',
    beschreibung: 'Metadaten-Vorschläge, Kurzbeschreibungen, Differenzierung und Materialerstellung.',
    modellLabel: 'Chat-Modell',
    icon: 'comment',
  },
  vision: {
    titel: 'Vision',
    beschreibung:
      'Texterkennung gescannter Dateien (auch beim Stapelimport) und Musterlösungen mit Seitenbildern. Ohne eigenes Modell arbeitet Vision mit dem Chat-Modell und dessen Anbieter.',
    modellLabel: 'Vision-Modell',
    icon: 'eye',
  },
  embedding: {
    titel: 'Embeddings',
    beschreibung: 'Vektoren für die semantische Suche. Läuft gut lokal – die Inhalte aller Materialien gehen an diesen Anbieter.',
    modellLabel: 'Embedding-Modell',
    icon: 'magnifying-glass',
  },
}

const MODELL_FELD = { chat: 'chatModel', vision: 'visionModel', embedding: 'embeddingModel' } as const

function eigenerAnbieter(rolle: AiRolle): boolean {
  return formular.rollen[rolle].provider !== 'standard'
}

/** Anbieter, über den die Aufgabe tatsächlich läuft (wie `aiVerbindung` auf dem Server). */
function wirksamerAnbieter(rolle: AiRolle): ProviderId {
  if (rolle === 'vision' && !formular.visionModel.trim()) return wirksamerAnbieter('chat')
  const eintrag = formular.rollen[rolle]
  return eintrag.provider === 'standard' ? formular.provider : eintrag.provider
}

function wirksameUrl(rolle: AiRolle): string {
  if (rolle === 'vision' && !formular.visionModel.trim()) return wirksameUrl('chat')
  const eintrag = formular.rollen[rolle]
  if (eintrag.provider === 'standard') return formular.baseUrl.trim() || STANDARD_URLS[formular.provider]
  return eintrag.baseUrl.trim() || STANDARD_URLS[eintrag.provider]
}

/** Liste und Empfehlungen einer Aufgabe kommen vom eigenen oder vom Standardanbieter. */
function quelleVon(rolle: AiRolle): Quelle {
  return eigenerAnbieter(rolle) ? rolle : 'standard'
}

const anbieterOptionen = computed(() => [
  {
    value: 'standard',
    label: `Wie Standardanbieter (${aiProviders.label(formular.provider)})`,
  },
  ...aiProviders.options().map((o) => ({ value: o.value, label: o.label })),
])

const testErgebnis = reactive<Record<Quelle, string | null>>({
  standard: null,
  chat: null,
  vision: null,
  embedding: null,
})

interface IndexStatus {
  documents: number
  embedded: number
  pending: number
  outdated: number
  models: string[]
  currentModel: string | null
  images: number
  imagesEmbedded: number
  job: { running: boolean; error: string | null }
}

const bildEmbeddingsMoeglich = computed(() => supportsImageEmbeddings(wirksamerAnbieter('embedding')))

/** Wie die Anbieter für Musterlösungen (Chat und Vision) mit dem Denkbudget umgehen. */
const denkmodusHinweis = computed(() => {
  const anbieter = new Set([wirksamerAnbieter('chat'), wirksamerAnbieter('vision')])
  if (anbieter.has('openai')) {
    return 'Bei OpenAI wirkt der Denkmodus nicht – dort bleiben die Anfragen unverändert.'
  }
  if (anbieter.has('ollama') || anbieter.has('openai_kompatibel')) {
    return 'Nur OpenRouter hält das Denkbudget genau ein. Ollama und OpenAI-kompatible Server (llama.cpp, vLLM) ' +
      'schalten das Denken nur ein und erhöhen das Ausgabelimit um das Budget.'
  }
  return null
})

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

// --- Embedding-Wechsel --------------------------------------------------------

/**
 * Ändern sich Embedding-Modell oder -Server, passen die vorhandenen Vektoren
 * nicht mehr: Sie werden nach dem Speichern komplett neu berechnet.
 */
const embeddingWechsel = computed<null | 'modell' | 'server'>(() => {
  const gespeichert = data.value?.ai
  if (!gespeichert?.embeddingsEnabled || !formular.embeddingsEnabled || !formular.enabled) return null
  if (!indexStatus.value?.embedded) return null
  if (formular.embeddingModel.trim() !== gespeichert.embeddingModel.trim()) return 'modell'
  const verbindung = gespeichert.embeddingVerbindung
  if (!verbindung) return null
  const url = (wert: string) => wert.trim().replace(/\/+$/, '').toLowerCase()
  if (verbindung.provider !== wirksamerAnbieter('embedding') || url(verbindung.baseUrl) !== url(wirksameUrl('embedding'))) {
    return 'server'
  }
  return null
})

const embeddingWarnung = computed(() => {
  if (!embeddingWechsel.value) return null
  const anzahl = indexStatus.value?.documents ?? 0
  const dimensionen = data.value?.ai.embeddingDimensionen ?? 1536
  const teile = [
    embeddingWechsel.value === 'modell'
      ? `Neues Embedding-Modell: Alle ${anzahl} Abschnitte werden nach dem Speichern neu vektorisiert.`
      : `Anderer Embedding-Server bei gleichem Modellnamen: Die vorhandenen Vektoren werden beim Speichern verworfen und alle ${anzahl} Abschnitte neu berechnet, damit nie Vektoren zweier Modelle verglichen werden.`,
    'Bis dahin findet die semantische Suche nur bereits neu berechnete Abschnitte; die Volltextsuche bleibt vollständig.',
    `Vektoren werden unabhängig vom Modell auf ${dimensionen} Dimensionen gebracht – ein Wechsel ist ohne Datenbankänderung möglich.`,
  ]
  if (EXTERNE_ANBIETER.includes(wirksamerAnbieter('embedding'))) {
    teile.push('Der externe Anbieter erhält dafür die Inhalte aller Materialien und berechnet die Anfragen in der Regel als Kosten.')
  }
  return teile.join(' ')
})

// --- Empfehlungen -------------------------------------------------------------

function hinweiseFuer(provider: ProviderId) {
  const hints = data.value?.modelHints?.[provider]
  if (provider === 'ollama') {
    return {
      chat: hints?.chatModel ?? 'gemma4:e4b-it-qat',
      vision: hints?.visionModel ?? 'gemma4:e4b-it-qat',
      embedding: hints?.embeddingModel ?? OLLAMA_EMBEDDING_MODEL,
      text: 'Für Musterlösungen multimodale Modelle empfohlen (Vision + Text), z. B. gemma4:e4b-it-qat. PDFs werden als Seitenbilder ausgewertet; Lösungen erscheinen als Text-Overlay auf den Originalseiten.',
      embeddingHinweis:
        `Für die Vektorsuche z. B. ${OLLAMA_EMBEDDING_MODEL} (ollama pull ${OLLAMA_EMBEDDING_MODEL}). OpenAI-Modelle wie text-embedding-3-small funktionieren bei Ollama nicht.`,
    }
  }
  if (provider === 'openai_kompatibel') {
    return {
      chat: 'aus der Liste wählen',
      vision: 'aus der Liste wählen',
      embedding: 'aus der Liste wählen',
      text: 'Für llama.cpp (llama-server), LM Studio, vLLM und andere Server mit OpenAI-Schnittstelle. Arbeitsblätter werden als Seitenbilder übergeben – für Musterlösungen ein multimodales Modell wählen (bei llama.cpp mit --mmproj gestartet).',
      embeddingHinweis: 'Ein Embedding-Modell des Servers, z. B. qwen3-embedding oder embeddinggemma-2 (mit --mmproj gestartet auch für Seitenbilder). Nach einem Wechsel die Vektoren neu berechnen.',
    }
  }
  if (provider === 'openai') {
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
}

const hinweise = computed(() => hinweiseFuer(formular.provider))

/** Anbieter, dessen Empfehlungen für das Modellfeld einer Aufgabe gelten. */
function empfehlungsAnbieter(rolle: AiRolle): ProviderId {
  const eintrag = formular.rollen[rolle]
  return eintrag.provider === 'standard' ? formular.provider : eintrag.provider
}

function rollenHinweis(rolle: AiRolle): string {
  const name = formular[MODELL_FELD[rolle]]
  if (fehltAufServer(name, rolle)) return 'Dieser Name steht nicht in der Liste des Servers.'
  const hints = hinweiseFuer(empfehlungsAnbieter(rolle))
  if (rolle === 'chat') return `Empfehlung: ${hints.chat}`
  if (rolle === 'vision') return 'Für Arbeitsblätter/PDFs – muss Bilder verarbeiten können.'
  return hints.embeddingHinweis
}

function anbieterHinweiseUebernehmen() {
  for (const rolle of AI_ROLLEN) {
    const hints = data.value?.modelHints?.[empfehlungsAnbieter(rolle)]
    if (!hints) continue
    // Leere Empfehlungen (OpenAI-kompatibel) überschreiben nichts – dort gibt der Server die Namen vor.
    const empfehlung = { chat: hints.chatModel, vision: hints.visionModel, embedding: hints.embeddingModel }[rolle]
    if (empfehlung) formular[MODELL_FELD[rolle]] = empfehlung
  }
  const standard = data.value?.modelHints?.[formular.provider]
  if (standard) formular.useVision = standard.useVision
  if (!formular.baseUrl.trim()) formular.baseUrl = STANDARD_URLS[formular.provider]
}

// --- Modelllisten -------------------------------------------------------------

interface ModellInfo {
  id: string
  aliase: string[]
  bild: boolean | null
  embedding: boolean | null
}

interface ModellListe {
  modelle: ModellInfo[]
  warnung: string | null
  fehler: string | null
  laedt: boolean
  nummer: number
}

function leereListe(): ModellListe {
  return { modelle: [], warnung: null, fehler: null, laedt: false, nummer: 0 }
}

const listen = reactive<Record<Quelle, ModellListe>>({
  standard: leereListe(),
  chat: leereListe(),
  vision: leereListe(),
  embedding: leereListe(),
})

function listeVon(rolle: AiRolle): ModellListe {
  return listen[quelleVon(rolle)]
}

async function modelleAbrufen(quelle: Quelle = 'standard') {
  if (quelle !== 'standard' && !eigenerAnbieter(quelle)) return
  const liste = listen[quelle]
  const nummer = ++liste.nummer
  liste.laedt = true
  liste.fehler = null
  try {
    const body: Record<string, unknown> = { provider: formular.provider, baseUrl: formular.baseUrl }
    if (formular.apiKey.trim()) body.apiKey = formular.apiKey
    if (quelle !== 'standard') {
      const eintrag = formular.rollen[quelle]
      body.rolle = quelle
      body.rollen = {
        [quelle]: {
          provider: eintrag.provider,
          baseUrl: eintrag.baseUrl,
          ...(eintrag.apiKey.trim() ? { apiKey: eintrag.apiKey } : {}),
        },
      }
    }
    // Schlichter Funktionstyp – siehe useApi (Routentypen werden sonst zu tief).
    const holen = $fetch as unknown as (
      url: string,
      opts: object,
    ) => Promise<{ modelle: ModellInfo[]; warnung: string | null }>
    const ergebnis = await holen('/api/settings/ai-models', { method: 'POST', body })
    if (nummer !== liste.nummer) return
    liste.modelle = ergebnis.modelle
    liste.warnung = ergebnis.warnung
  } catch (error) {
    if (nummer !== liste.nummer) return
    liste.modelle = []
    liste.warnung = null
    liste.fehler = toApiFehler(error).nachricht
  } finally {
    if (nummer === liste.nummer) liste.laedt = false
  }
}

// Anbieter oder Adresse geändert: Liste mit kurzer Verzögerung neu laden.
const ladeTimer: Partial<Record<Quelle, ReturnType<typeof setTimeout>>> = {}
function spaeterLaden(quelle: Quelle) {
  if (ladeTimer[quelle]) clearTimeout(ladeTimer[quelle])
  ladeTimer[quelle] = setTimeout(() => void modelleAbrufen(quelle), 600)
}
watch(
  () => [formular.provider, formular.baseUrl] as const,
  () => spaeterLaden('standard'),
)
for (const rolle of AI_ROLLEN) {
  watch(
    () => [formular.rollen[rolle].provider, formular.rollen[rolle].baseUrl] as const,
    () => spaeterLaden(rolle),
  )
}
onMounted(() => {
  void modelleAbrufen('standard')
  for (const rolle of AI_ROLLEN) void modelleAbrufen(rolle)
})
onBeforeUnmount(() => {
  for (const timer of Object.values(ladeTimer)) clearTimeout(timer)
})

function alsOption(modell: ModellInfo, nachrangig: boolean): KombiOption {
  const zusaetze = modell.aliase.slice(0, 1)
  if (modell.bild) zusaetze.push('Bild')
  if (modell.embedding) zusaetze.push('Embedding')
  return { wert: modell.id, zusaetze, gleichwertig: modell.aliase, nachrangig }
}

function optionenFuer(rolle: AiRolle): KombiOption[] {
  const modelle = listeVon(rolle).modelle
  if (rolle === 'chat') return modelle.map((m) => alsOption(m, m.embedding === true))
  if (rolle === 'vision') return modelle.map((m) => alsOption(m, m.embedding === true || m.bild === false))
  // Erkennt der Server keine Embedding-Modelle, bleiben alle gleichrangig.
  const bekannt = modelle.some((m) => m.embedding === true)
  return modelle.map((m) => alsOption(m, bekannt && m.embedding !== true))
}

/** Steht der eingetragene Name (oder ein Alias) nicht in der Liste des Servers? */
function fehltAufServer(name: string, rolle: AiRolle): boolean {
  const n = name.trim()
  const modelle = listeVon(rolle).modelle
  if (!n || !modelle.length) return false
  return !modelle.some((m) => m.id === n || m.aliase.includes(n))
}

function listenStatus(liste: ModellListe): string {
  return liste.modelle.length
    ? `${liste.modelle.length} Modelle auf dem Server – Felder aufklappen oder Namen eintippen.`
    : 'Der Server meldet keine Modelle.'
}

function aufOpenAiKompatibelUmstellen(quelle: Quelle) {
  if (quelle === 'standard') formular.provider = 'openai_kompatibel'
  else formular.rollen[quelle].provider = 'openai_kompatibel'
}

// --- Speichern und Testen -----------------------------------------------------

/**
 * Formularstand für die API. Leere Schlüssel bleiben gespeichert; wechselt eine
 * Aufgabe zurück zum Standardanbieter, wird ihr eigener Schlüssel gelöscht.
 */
function entwurf(): Record<string, unknown> {
  const { rollen, ...rest } = formular
  const body: Record<string, unknown> = { ...rest }
  if (!formular.apiKey.trim()) delete body.apiKey
  body.rollen = Object.fromEntries(
    AI_ROLLEN.map((rolle) => {
      const eintrag = rollen[rolle]
      const wert: Record<string, unknown> = {
        provider: eintrag.provider,
        baseUrl: eintrag.provider === 'standard' ? '' : eintrag.baseUrl,
      }
      if (eintrag.provider === 'standard') wert.apiKey = null
      else if (eintrag.apiKey.trim()) wert.apiKey = eintrag.apiKey
      return [rolle, wert]
    }),
  )
  return body
}

const bestaetigungOffen = ref(false)

function speichernKlick() {
  if (embeddingWarnung.value) bestaetigungOffen.value = true
  else void speichern()
}

async function speichern() {
  const ergebnis = await aufruf<{ embeddingsVerworfen?: boolean }>('/api/settings/ai', {
    method: 'PATCH',
    body: entwurf(),
    erfolgsmeldung: 'KI-Einstellungen gespeichert.',
  })
  if (!ergebnis) return
  await refresh()
  await indexStatusLaden()
}

async function testen(quelle: Quelle = 'standard') {
  testErgebnis[quelle] = null
  const body = entwurf()
  if (quelle !== 'standard') body.rolle = quelle
  try {
    const ergebnis = await aufruf<{ ok?: boolean; message?: string; modell?: string }>(
      '/api/settings/ai-test',
      { method: 'POST', body, stumm: true },
    )
    testErgebnis[quelle] = ergebnis?.message ?? 'Verbindung erfolgreich.'
    void modelleAbrufen(quelle)
  } catch (error) {
    testErgebnis[quelle] = (error as { nachricht?: string }).nachricht ?? 'Test fehlgeschlagen.'
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

    <UiCard titel="Standardanbieter" icon="wand-magic-sparkles">
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
            <span v-if="listen.standard.laedt" class="text-ink-subtle">Modelle werden geladen …</span>
            <span v-else-if="listen.standard.fehler" class="text-danger">
              Modellliste nicht verfügbar: {{ listen.standard.fehler }}
            </span>
            <span v-else class="text-ink-subtle">{{ listenStatus(listen.standard) }}</span>
            <button type="button" class="text-primary hover:underline" @click="modelleAbrufen('standard')">
              Neu laden
            </button>
          </div>
          <p
            v-if="listen.standard.warnung"
            class="sm:col-span-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-ink-muted"
          >
            {{ listen.standard.warnung }}
            <button
              type="button"
              class="ml-1 font-medium text-primary hover:underline"
              @click="aufOpenAiKompatibelUmstellen('standard')"
            >
              Jetzt umstellen
            </button>
          </p>
          <p
            v-if="testErgebnis.standard"
            class="sm:col-span-2 rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink-muted"
          >
            {{ testErgebnis.standard }}
          </p>
        </div>
      </div>
    </UiCard>

    <UiCard titel="Modelle und Anbieter je Aufgabe" icon="sliders">
      <div class="space-y-4">
        <p class="text-sm text-ink-muted">
          Jede Aufgabe läuft über den Standardanbieter oder über einen eigenen – etwa Vision bei einem
          schnellen externen Dienst und Embeddings weiterhin lokal.
        </p>

        <section
          v-for="rolle in AI_ROLLEN"
          :key="rolle"
          class="space-y-3 rounded-lg border border-line p-4"
        >
          <div>
            <h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
              <UiIcon :name="ROLLEN_INFO[rolle].icon" />
              {{ ROLLEN_INFO[rolle].titel }}
            </h3>
            <p class="mt-1 text-xs text-ink-subtle">{{ ROLLEN_INFO[rolle].beschreibung }}</p>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <UiField label="Anbieter">
              <UiSelect v-model="formular.rollen[rolle].provider" :optionen="anbieterOptionen" />
            </UiField>
            <UiField :label="ROLLEN_INFO[rolle].modellLabel" :hinweis="rollenHinweis(rolle)">
              <UiKombifeld
                v-model="formular[MODELL_FELD[rolle]]"
                :optionen="optionenFuer(rolle)"
                :laedt="listeVon(rolle).laedt"
                :placeholder="hinweiseFuer(empfehlungsAnbieter(rolle))[rolle]"
              />
            </UiField>

            <template v-if="eigenerAnbieter(rolle)">
              <UiField label="Basis-URL">
                <UiInput
                  v-model="formular.rollen[rolle].baseUrl"
                  :placeholder="STANDARD_URLS[empfehlungsAnbieter(rolle)]"
                />
              </UiField>
              <UiField
                label="API-Schlüssel"
                :hinweis="formular.rollen[rolle].apiKeyGesetzt ? 'Gesetzt – leer lassen, um beizubehalten.' : 'Eigener Schlüssel dieses Anbieters.'"
              >
                <UiInput
                  v-model="formular.rollen[rolle].apiKey"
                  type="password"
                  autocomplete="off"
                  placeholder="••••••••"
                />
              </UiField>
              <div class="flex flex-wrap items-center gap-2 text-xs sm:col-span-2">
                <span v-if="listen[rolle].laedt" class="text-ink-subtle">Modelle werden geladen …</span>
                <span v-else-if="listen[rolle].fehler" class="text-danger">
                  Modellliste nicht verfügbar: {{ listen[rolle].fehler }}
                </span>
                <span v-else class="text-ink-subtle">{{ listenStatus(listen[rolle]) }}</span>
                <button type="button" class="text-primary hover:underline" @click="modelleAbrufen(rolle)">
                  Neu laden
                </button>
                <button
                  type="button"
                  class="text-primary hover:underline disabled:opacity-50"
                  :disabled="laeuft"
                  @click="testen(rolle)"
                >
                  Verbindung testen
                </button>
              </div>
              <p
                v-if="listen[rolle].warnung"
                class="sm:col-span-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-ink-muted"
              >
                {{ listen[rolle].warnung }}
                <button
                  type="button"
                  class="ml-1 font-medium text-primary hover:underline"
                  @click="aufOpenAiKompatibelUmstellen(rolle)"
                >
                  Jetzt umstellen
                </button>
              </p>
              <p
                v-if="rolle === 'vision' && !formular.visionModel.trim()"
                class="sm:col-span-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-ink-muted"
              >
                Bitte ein Vision-Modell wählen – ohne eigenes Modell liefe Vision weiter über den Chat-Anbieter.
              </p>
              <p
                v-if="testErgebnis[rolle]"
                class="sm:col-span-2 rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink-muted"
              >
                {{ testErgebnis[rolle] }}
              </p>
            </template>
          </div>

          <template v-if="rolle === 'embedding'">
            <p
              v-if="data?.ai.embeddingModelWarnung"
              class="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-ink-muted"
            >
              {{ data.ai.embeddingModelWarnung }}
              <span v-if="data.ai.embeddingModelEffektiv && data.ai.embeddingModelEffektiv !== formular.embeddingModel">
                Bis zum Speichern wird intern vorläufig „{{ data.ai.embeddingModelEffektiv }}“ verwendet.
              </span>
            </p>
            <p
              v-if="embeddingWarnung"
              class="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-ink-muted"
              role="alert"
            >
              <UiIcon name="triangle-exclamation" class="mt-0.5 shrink-0 text-warning" />
              <span>{{ embeddingWarnung }}</span>
            </p>
          </template>
        </section>

        <div class="grid gap-4 sm:grid-cols-2">
          <UiField label="Temperatur">
            <UiInput v-model="formular.temperature" type="number" min="0" max="2" step="0.1" />
          </UiField>
          <UiField label="Timeout (ms)" hinweis="Vision-Läufe brauchen oft länger">
            <UiInput v-model="formular.timeoutMs" type="number" min="5000" step="1000" />
          </UiField>
        </div>

        <div class="space-y-2 text-sm">
          <div class="flex flex-wrap items-center gap-4">
            <label class="flex items-center gap-2">
              <input v-model="formular.denkmodusMusterloesungen" type="checkbox" class="accent-[var(--color-primary)]">
              Denkmodus für Musterlösungen
            </label>
            <label class="flex items-center gap-2" :class="{ 'opacity-50': !formular.denkmodusMusterloesungen }">
              Denkbudget (Tokens)
              <UiInput
                v-model="formular.denkBudget"
                type="number"
                min="256"
                max="32000"
                step="256"
                class="w-28"
                :disabled="!formular.denkmodusMusterloesungen"
              />
            </label>
          </div>
          <p class="text-xs text-ink-muted">
            Denkmodelle dürfen beim Lösen und Prüfen von Aufgaben zusätzlich nachdenken – mit eigenem Budget, das
            nicht von der Antwort abgeht. Metadaten, Kurzbeschreibungen und Texterkennung bleiben ohne Denkmodus.
            Das kostet mehr Zeit und Tokens; ggf. das Timeout erhöhen.
          </p>
          <p
            v-if="formular.denkmodusMusterloesungen && denkmodusHinweis"
            class="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-ink-muted"
          >
            {{ denkmodusHinweis }}
          </p>
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
          <label
            class="flex items-center gap-2"
            :class="{ 'opacity-50': !formular.embeddingsEnabled || !bildEmbeddingsMoeglich }"
            :title="bildEmbeddingsMoeglich ? undefined : 'Ollama und OpenAI nehmen für Embeddings nur Text an.'"
          >
            <input
              v-model="formular.embedImages"
              type="checkbox"
              class="accent-[var(--color-primary)]"
              :disabled="!formular.embeddingsEnabled || !bildEmbeddingsMoeglich"
            >
            Seitenbilder einbetten (multimodale Embedding-Modelle)
          </label>
        </div>
        <p
          v-if="formular.embeddingsEnabled && formular.embedImages && bildEmbeddingsMoeglich"
          class="text-xs text-ink-muted"
        >
          Seiten von PDFs, Office-Dateien und Bildern werden zusätzlich als Bild vektorisiert, damit auch
          Abbildungen, Diagramme und Scans gefunden werden. Benötigt ein multimodales Embedding-Modell wie
          EmbeddingGemma 2 – bei llama.cpp mit <code>--mmproj</code> gestartet.
        </p>

        <div class="flex flex-wrap justify-end gap-2">
          <UiButton variante="sekundaer" icon="lightbulb" @click="anbieterHinweiseUebernehmen">
            Empfehlungen übernehmen
          </UiButton>
          <UiButton variante="sekundaer" icon="flask" :laedt="laeuft" @click="testen('standard')">
            Standardanbieter testen
          </UiButton>
          <UiButton variante="primaer" icon="floppy-disk" :laedt="laeuft" @click="speichernKlick">
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
                <template v-if="indexStatus.images">
                  (davon {{ indexStatus.imagesEmbedded }} von {{ indexStatus.images }} Seitenbildern)
                </template>
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

    <UiConfirm
      v-model="bestaetigungOffen"
      titel="Vektoren neu berechnen?"
      :text="embeddingWarnung ?? ''"
      bestaetigen="Speichern und neu berechnen"
      icon="triangle-exclamation"
      @bestaetigt="speichern"
    />
  </LayoutEinstellungsSeite>
</template>
