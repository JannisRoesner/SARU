<script setup lang="ts">
import { importStatuses } from '#shared/utils/labels'
import {
  auswahlZusammenfassen,
  eintragHatNeues,
  wirdAngelegt,
  type AnalyseEintrag,
  type EintragArt,
  type SicherungAnalyse,
} from '#shared/utils/sicherung'

useHead({ title: 'Sicherung & Umzug' })

const { istAdmin } = useSitzung()
if (!istAdmin.value) await navigateTo('/einstellungen')

const route = useRoute()
const router = useRouter()
const hinweise = useHinweise()
const { aufruf, laeuft } = useApi()

// --- Export -----------------------------------------------------------------

const { data: uebersicht } = await useFetch<{
  materialien: number
  lehrwerke: number
  reihen: number
  stunden: number
  dateien: number
  bytes: number
}>('/api/sicherung/uebersicht')

const exportKacheln = computed(() => {
  const u = uebersicht.value
  if (!u) return []
  return [
    { label: 'Materialien', wert: formatZahl(u.materialien) },
    { label: 'davon Lehrwerke', wert: formatZahl(u.lehrwerke) },
    { label: 'Reihen', wert: formatZahl(u.reihen) },
    { label: 'Stunden', wert: formatZahl(u.stunden) },
    { label: 'Dateien', wert: formatZahl(u.dateien) },
    { label: 'Größe (ca.)', wert: formatBytes(u.bytes) },
  ]
})

function herunterladen() {
  // Der Browser übernimmt den Download direkt – nichts davon landet im Speicher der Seite.
  window.location.href = '/api/sicherung/export'
  hinweise.info('Die Sicherung wird zusammengestellt. Der Download startet gleich.')
}

// --- Import: Vorgang ----------------------------------------------------------

interface SicherungLauf {
  analyse: SicherungAnalyse
  status: string
  stats: Record<string, number>
  errorMessage: string | null
  startedAt: string
  finishedAt: string | null
  canCommit: boolean
  canUndo: boolean
  logs: Array<{ id: string; level: string; message: string; createdAt: string }>
}

const laufId = computed(() => (typeof route.query.lauf === 'string' ? route.query.lauf : null))

// Beim Server-Rendering muss das Sitzungs-Cookie mitgeschickt werden.
const anfrage = useRequestFetch()
const { data: lauf, refresh: laufLaden, error: laufFehler } = await useAsyncData(
  'sicherung-lauf',
  () => (laufId.value ? anfrage<SicherungLauf>(`/api/sicherung/import/${laufId.value}`) : Promise.resolve(null)),
  { watch: [laufId], default: () => null },
)

const { data: laeufe, refresh: laeufeLaden } = await useFetch<
  Array<{
    id: string
    sourceFileName: string
    sourceSizeBytes: number | null
    status: string
    stats: Record<string, number>
    startedAt: string
  }>
>('/api/sicherung/import', { default: () => [] })

function laufOeffnen(id: string | null) {
  void router.replace({ query: id ? { lauf: id } : {} })
}

let abfrage: ReturnType<typeof setInterval> | null = null
watch(
  () => lauf.value?.status,
  (status) => {
    if (status === 'laeuft' && !abfrage) {
      abfrage = setInterval(() => void laufLaden(), 1500)
    } else if (status !== 'laeuft' && abfrage) {
      clearInterval(abfrage)
      abfrage = null
      void laeufeLaden()
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => abfrage && clearInterval(abfrage))

// --- Import: Hochladen --------------------------------------------------------

const dateiFeld = ref<HTMLInputElement | null>(null)
const upload = reactive({ aktiv: false, fortschritt: 0, datei: '' })

function hochladen(datei: File): Promise<SicherungAnalyse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/sicherung/import')
    xhr.setRequestHeader('content-type', 'application/zip')
    xhr.setRequestHeader('x-dateiname', encodeURIComponent(datei.name))
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) upload.fortschritt = e.loaded / e.total
    }
    xhr.onload = () => {
      let antwort: { message?: string } | null = null
      try {
        antwort = JSON.parse(xhr.responseText)
      } catch {
        // Kein JSON, z. B. Fehlerseite eines Reverse-Proxys.
      }
      if (xhr.status >= 200 && xhr.status < 300 && antwort) resolve(antwort as SicherungAnalyse)
      else if (xhr.status === 413) reject(new Error('Die Datei ist zu groß für den Server oder einen vorgeschalteten Proxy.'))
      else reject(new Error(antwort?.message || 'Die Sicherung konnte nicht hochgeladen werden.'))
    }
    xhr.onerror = () => reject(new Error('Der Server ist nicht erreichbar.'))
    xhr.send(datei)
  })
}

async function dateiGewaehlt(event: Event) {
  const eingabe = event.target as HTMLInputElement
  const datei = eingabe.files?.[0]
  eingabe.value = ''
  if (!datei) return
  if (!datei.name.toLowerCase().endsWith('.zip')) {
    hinweise.fehler('Bitte eine SARU-Sicherung im ZIP-Format auswählen.')
    return
  }
  Object.assign(upload, { aktiv: true, fortschritt: 0, datei: datei.name })
  try {
    const analyse = await hochladen(datei)
    laufOeffnen(analyse.runId)
    await laeufeLaden()
  } catch (error) {
    hinweise.fehler((error as Error).message)
  } finally {
    upload.aktiv = false
  }
}

// --- Import: Auswahl ----------------------------------------------------------

const analyse = computed(() => lauf.value?.analyse ?? null)
const inhaltsgleicheAnlegen = ref(false)
const gewaehlt = ref<Record<string, boolean>>({})
const filter = ref('')

function standardauswahl() {
  const a = analyse.value
  if (!a) return
  gewaehlt.value = Object.fromEntries(a.eintraege.map((e) => [e.id, eintragHatNeues(a, e, inhaltsgleicheAnlegen.value)]))
}
watch(() => analyse.value?.runId, standardauswahl, { immediate: true })

const GRUPPEN: Array<{ art: EintragArt; titel: string; icon: string }> = [
  { art: 'lehrwerk', titel: 'Lehrwerke', icon: 'book' },
  { art: 'reihe', titel: 'Reihen', icon: 'layer-group' },
  { art: 'stunde', titel: 'Stunden ohne Reihe', icon: 'chalkboard-user' },
  { art: 'material', titel: 'Einzelne Materialien', icon: 'file-lines' },
]
const MAX_ZEILEN = 300

const gruppen = computed(() => {
  const a = analyse.value
  if (!a) return []
  const suche = filter.value.trim().toLowerCase()
  return GRUPPEN.map((gruppe) => {
    const alle = a.eintraege.filter((e) => e.art === gruppe.art)
    const sichtbar = suche
      ? alle.filter((e) => `${e.titel} ${e.untertitel ?? ''}`.toLowerCase().includes(suche))
      : alle
    return {
      ...gruppe,
      alle,
      sichtbar: sichtbar.slice(0, MAX_ZEILEN),
      ausgeblendet: Math.max(0, sichtbar.length - MAX_ZEILEN),
      anzahlGewaehlt: alle.filter((e) => gewaehlt.value[e.id]).length,
      gefiltert: sichtbar,
    }
  }).filter((g) => g.alle.length > 0)
})

function gruppeSetzen(eintraege: AnalyseEintrag[], wert: boolean) {
  const neu = { ...gewaehlt.value }
  for (const e of eintraege) neu[e.id] = wert
  gewaehlt.value = neu
}

/** Wie viel eines Eintrags ist neu? Für die Kennzeichnung in der Liste. */
function eintragStatus(e: AnalyseEintrag): { text: string; ton: 'neutral' | 'gelb' } | null {
  const a = analyse.value!
  const teile = [
    ...e.materialIds.map((id) => a.materialien[id]?.dublette),
    ...e.stundenIds.map((id) => a.stunden[id]?.dublette),
    ...e.reihenIds.map((id) => a.reihen[id]?.dublette),
  ]
  const neu = teile.filter((d) => wirdAngelegt(d, inhaltsgleicheAnlegen.value)).length
  if (neu === teile.length) return null
  if (neu === 0) return { text: 'Bereits vorhanden', ton: 'neutral' }
  return { text: `${neu} von ${teile.length} neu`, ton: 'gelb' }
}

function eigeneDublette(e: AnalyseEintrag) {
  const a = analyse.value!
  const d = e.art === 'reihe' ? a.reihen[e.id]?.dublette : e.art === 'stunde' ? a.stunden[e.id]?.dublette : a.materialien[e.id]?.dublette
  return d?.art === 'gleicher_inhalt' ? d : null
}

const auswahlIds = computed(() => Object.keys(gewaehlt.value).filter((id) => gewaehlt.value[id]))
const zusammenfassung = computed(() =>
  analyse.value
    ? auswahlZusammenfassen(analyse.value, { eintraege: auswahlIds.value, inhaltsgleicheAnlegen: inhaltsgleicheAnlegen.value })
    : null,
)
const nichtsNeues = computed(() => {
  const z = zusammenfassung.value
  return !z || z.materialien + z.stunden + z.reihen === 0
})

async function starten() {
  const ergebnis = await aufruf<SicherungLauf>(`/api/sicherung/import/${laufId.value}/start`, {
    method: 'POST',
    body: { eintraege: auswahlIds.value, inhaltsgleicheAnlegen: inhaltsgleicheAnlegen.value },
  })
  if (ergebnis) lauf.value = ergebnis
}

const verwerfenOffen = ref(false)
async function verwerfen() {
  const ok = await aufruf(`/api/sicherung/import/${laufId.value}`, { method: 'DELETE', erfolgsmeldung: 'Vorschau verworfen.' })
  if (ok) {
    laufOeffnen(null)
    await laeufeLaden()
  }
}

const rueckgaengigOffen = ref(false)
async function rueckgaengig() {
  const ok = await aufruf(`/api/sicherung/import/${laufId.value}/undo`, {
    method: 'POST',
    erfolgsmeldung: 'Import rückgängig gemacht.',
  })
  if (ok) {
    await laufLaden()
    await laeufeLaden()
  }
}

const fortschritt = computed(() => {
  const s = lauf.value?.stats
  if (!s?.gesamt) return 0
  return Math.min(1, (s.erledigt ?? 0) / s.gesamt)
})

const ergebnisKacheln = computed(() => {
  const s = lauf.value?.stats
  if (!s) return []
  return [
    { label: 'Materialien', wert: s.materialien ?? 0 },
    { label: 'Dateien', wert: s.dateien ?? 0 },
    { label: 'Reihen', wert: s.reihen ?? 0 },
    { label: 'Stunden', wert: s.stunden ?? 0 },
    { label: 'Bereits vorhanden', wert: s.uebersprungen ?? 0 },
    { label: 'Fehlgeschlagen', wert: s.fehlgeschlagen ?? 0 },
  ]
})

const meldungen = computed(() => (lauf.value?.logs ?? []).filter((l) => l.level !== 'info'))
</script>

<template>
  <LayoutEinstellungsSeite>
    <LayoutSeitenkopf
      zurueck-to="/einstellungen"
      zurueck-label="Einstellungen"
      kicker="System"
      titel="Sicherung & Umzug"
      untertitel="Alle Inhalte als ZIP sichern und in eine andere Instanz einspielen"
    />

    <UiCard titel="Sicherung herunterladen" icon="box-archive">
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div v-for="kachel in exportKacheln" :key="kachel.label" class="rounded-xl bg-surface-sunken px-3 py-2">
          <p class="text-xs text-ink-subtle">{{ kachel.label }}</p>
          <p class="text-lg font-semibold tabular-nums text-ink">{{ kachel.wert }}</p>
        </div>
      </div>
      <p class="mt-4 text-sm text-ink-muted">
        Enthält alle Lehrwerke, Materialien mit Varianten und Dateien, Reihen, Stunden sowie Fächer,
        Themen, Tags und Kompetenzen. Die Dateien liegen lesbar nach Lehrwerk bzw. Fach sortiert im Archiv.
      </p>
      <p class="mt-2 text-xs text-ink-subtle">
        Nicht enthalten: Benutzerkonten, Einstellungen und API-Schlüssel, Freigabe-Links und KI-Protokolle.
        Besitzer werden beim Einspielen über die E-Mail-Adresse zugeordnet.
      </p>
      <div class="mt-4 flex justify-end">
        <UiButton variante="primaer" icon="download" @click="herunterladen">Sicherung herunterladen</UiButton>
      </div>
    </UiCard>

    <UiCard titel="Sicherung einspielen" icon="upload">
      <UiFehlerzustand v-if="laufFehler" :text="toApiFehler(laufFehler).nachricht" @erneut="laufLaden()" />

      <!-- Schritt 1: Datei wählen -->
      <div v-else-if="!lauf">
        <p class="text-sm text-ink-muted">
          Lade eine SARU-Sicherung hoch. Vor dem Import siehst du, was enthalten ist, kannst einzelne
          Lehrwerke, Reihen, Stunden und Materialien abwählen – bereits Vorhandenes wird erkannt.
        </p>
        <div v-if="upload.aktiv" class="mt-4 space-y-2">
          <p class="text-sm text-ink">
            {{ upload.fortschritt < 1 ? `„${upload.datei}“ wird hochgeladen …` : 'Sicherung wird geprüft …' }}
          </p>
          <div class="h-2 overflow-hidden rounded-full bg-surface-sunken">
            <div class="h-full bg-primary-solid transition-[width]" :style="{ width: `${Math.round(upload.fortschritt * 100)}%` }" />
          </div>
          <p class="text-xs tabular-nums text-ink-subtle">{{ Math.round(upload.fortschritt * 100) }} %</p>
        </div>
        <div v-else class="mt-4 flex justify-end">
          <input ref="dateiFeld" type="file" accept=".zip,application/zip" class="hidden" @change="dateiGewaehlt">
          <UiButton variante="primaer" icon="file-zipper" @click="dateiFeld?.click()">ZIP-Datei auswählen</UiButton>
        </div>
      </div>

      <template v-else-if="analyse">
        <div class="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <UiBadge :ton="importStatuses.tone(lauf.status as never)" :icon="importStatuses.icon(lauf.status as never)">
            {{ importStatuses.label(lauf.status as never) }}
          </UiBadge>
          <span class="font-medium text-ink">{{ analyse.dateiName }}</span>
          <span>{{ formatBytes(analyse.dateiGroesse) }}</span>
          <span v-if="analyse.erstelltAm">· erstellt {{ formatDatumZeit(analyse.erstelltAm) }}</span>
          <span v-if="analyse.exportiertVon">von {{ analyse.exportiertVon }}</span>
        </div>

        <ul v-if="analyse.warnungen.length" class="mt-3 space-y-1">
          <li v-for="w in analyse.warnungen" :key="w" class="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">{{ w }}</li>
        </ul>
        <p v-if="lauf.errorMessage" class="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{{ lauf.errorMessage }}</p>

        <!-- Schritt 2: Auswahl -->
        <template v-if="lauf.canCommit">
          <div class="mt-5 space-y-3">
            <UiToggle
              v-model="inhaltsgleicheAnlegen"
              label="Inhaltsgleiches trotzdem neu anlegen"
              hinweis="Standard: Materialien mit identischen Dateien sowie Stunden und Reihen mit gleichem Titel und Termin werden mit dem Vorhandenen verknüpft statt doppelt angelegt. Bereits eingespielte Datensätze (gleiche Kennung) werden nie doppelt angelegt."
            />
            <UiInput v-model="filter" icon="magnifying-glass" placeholder="Einträge filtern …" />
          </div>

          <div class="mt-4 space-y-3">
            <details v-for="gruppe in gruppen" :key="gruppe.art" class="group rounded-xl border border-line" open>
              <summary class="flex cursor-pointer list-none items-center gap-2 px-4 py-3">
                <UiIcon name="chevron-right" fest class="text-ink-subtle transition-transform group-open:rotate-90" />
                <UiIcon :name="gruppe.icon" fest class="text-primary" />
                <span class="font-semibold text-ink">{{ gruppe.titel }}</span>
                <span class="text-sm tabular-nums text-ink-subtle">{{ gruppe.anzahlGewaehlt }} / {{ gruppe.alle.length }}</span>
                <span class="ml-auto flex gap-1">
                  <UiButton groesse="sm" variante="still" @click.prevent="gruppeSetzen(gruppe.gefiltert, true)">Alle</UiButton>
                  <UiButton groesse="sm" variante="still" @click.prevent="gruppeSetzen(gruppe.gefiltert, false)">Keine</UiButton>
                </span>
              </summary>
              <ul class="max-h-[28rem] divide-y divide-line overflow-y-auto border-t border-line">
                <li v-for="eintrag in gruppe.sichtbar" :key="eintrag.id">
                  <label class="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-surface-sunken">
                    <input v-model="gewaehlt[eintrag.id]" type="checkbox" class="mt-1 accent-[var(--color-primary)]">
                    <span class="min-w-0 flex-1">
                      <span class="block break-words text-sm font-medium text-ink">{{ eintrag.titel }}</span>
                      <span v-if="eintrag.untertitel" class="block text-xs text-ink-subtle">{{ eintrag.untertitel }}</span>
                      <span v-if="eigeneDublette(eintrag)" class="block text-xs text-warning">
                        Inhaltsgleich mit „{{ eigeneDublette(eintrag)!.titel }}“
                      </span>
                    </span>
                    <UiBadge v-if="eintragStatus(eintrag)" :ton="eintragStatus(eintrag)!.ton">
                      {{ eintragStatus(eintrag)!.text }}
                    </UiBadge>
                  </label>
                </li>
                <li v-if="gruppe.ausgeblendet" class="px-4 py-2.5 text-xs text-ink-subtle">
                  {{ gruppe.ausgeblendet }} weitere – „Alle“/„Keine“ wirkt auch auf diese. Zum Eingrenzen den Filter nutzen.
                </li>
                <li v-if="!gruppe.sichtbar.length" class="px-4 py-2.5 text-xs text-ink-subtle">Keine Treffer</li>
              </ul>
            </details>
            <UiLeerzustand v-if="!gruppen.length" klein titel="Die Sicherung ist leer" />
          </div>

          <div v-if="zusammenfassung" class="sticky bottom-0 mt-4 rounded-xl border border-line bg-surface p-4 shadow-sm">
            <p class="text-sm text-ink">
              Wird angelegt:
              <strong>{{ formatZahl(zusammenfassung.materialien) }}</strong> Materialien
              ({{ formatZahl(zusammenfassung.dateien) }} Dateien, {{ formatBytes(zusammenfassung.bytes) }}),
              <strong>{{ formatZahl(zusammenfassung.reihen) }}</strong> Reihen,
              <strong>{{ formatZahl(zusammenfassung.stunden) }}</strong> Stunden
            </p>
            <p v-if="zusammenfassung.vorhanden" class="mt-1 text-xs text-ink-subtle">
              {{ formatZahl(zusammenfassung.vorhanden) }} bereits vorhandene Datensätze werden nicht doppelt angelegt, sondern verknüpft.
            </p>
            <div class="mt-3 flex flex-wrap justify-end gap-2">
              <UiButton variante="still" icon="trash" :disabled="laeuft" @click="verwerfenOffen = true">Verwerfen</UiButton>
              <UiButton variante="primaer" icon="file-import" :laedt="laeuft" :disabled="nichtsNeues" @click="starten">
                Import starten
              </UiButton>
            </div>
          </div>
        </template>

        <!-- Schritt 3: läuft -->
        <div v-else-if="lauf.status === 'laeuft'" class="mt-5 space-y-2">
          <p class="text-sm text-ink">Import läuft – du kannst die Seite verlassen, er läuft im Hintergrund weiter.</p>
          <div class="h-2 overflow-hidden rounded-full bg-surface-sunken">
            <div class="h-full bg-primary-solid transition-[width]" :style="{ width: `${Math.round(fortschritt * 100)}%` }" />
          </div>
          <p class="text-xs tabular-nums text-ink-subtle">
            {{ formatZahl(lauf.stats.erledigt ?? 0) }} von {{ formatZahl(lauf.stats.gesamt ?? 0) }} Datensätzen
          </p>
        </div>

        <!-- Schritt 4: Ergebnis -->
        <template v-else>
          <div class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div v-for="kachel in ergebnisKacheln" :key="kachel.label" class="rounded-xl bg-surface-sunken px-3 py-2">
              <p class="text-xs text-ink-subtle">{{ kachel.label }}</p>
              <p class="text-lg font-semibold tabular-nums text-ink">{{ formatZahl(kachel.wert) }}</p>
            </div>
          </div>
          <ul v-if="meldungen.length" class="mt-4 max-h-64 space-y-1 overflow-y-auto text-xs">
            <li
              v-for="m in meldungen"
              :key="m.id"
              class="rounded-lg px-2 py-1.5"
              :class="m.level === 'fehler' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'"
            >
              {{ m.message }}
            </li>
          </ul>
          <div class="mt-4 flex flex-wrap justify-end gap-2">
            <UiButton v-if="lauf.canUndo" variante="sekundaer" icon="rotate-left" :laedt="laeuft" @click="rueckgaengigOffen = true">
              Rückgängig machen
            </UiButton>
            <UiButton variante="primaer" icon="upload" @click="laufOeffnen(null)">Weitere Sicherung einspielen</UiButton>
          </div>
        </template>
      </template>
    </UiCard>

    <UiCard v-if="laeufe.length" titel="Bisherige Einspielungen" icon="clock-rotate-left" einklappbar einklapp-id="sicherung-laeufe" :standard-offen="false">
      <ul class="divide-y divide-line">
        <li v-for="eintrag in laeufe" :key="eintrag.id">
          <button
            type="button"
            class="flex w-full flex-wrap items-center gap-2 py-2.5 text-left hover:text-primary"
            @click="laufOeffnen(eintrag.id)"
          >
            <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ eintrag.sourceFileName }}</span>
            <span class="text-xs text-ink-subtle">{{ formatDatumZeit(eintrag.startedAt) }}</span>
            <UiBadge :ton="importStatuses.tone(eintrag.status as never)" :icon="importStatuses.icon(eintrag.status as never)">
              {{ importStatuses.label(eintrag.status as never) }}
            </UiBadge>
          </button>
        </li>
      </ul>
    </UiCard>

    <UiConfirm
      v-model="verwerfenOffen"
      titel="Vorschau verwerfen?"
      text="Die hochgeladene Sicherung wird vom Server entfernt. Es wurde noch nichts importiert."
      bestaetigen="Verwerfen"
      @bestaetigt="verwerfen"
    />
    <UiConfirm
      v-model="rueckgaengigOffen"
      gefahr
      titel="Import rückgängig machen?"
      text="Alle Materialien (samt Dateien), Reihen und Stunden, die dieser Import angelegt hat, werden gelöscht – auch wenn sie seitdem bearbeitet wurden. Bereits vorher Vorhandenes bleibt unverändert."
      bestaetigen="Rückgängig machen"
      @bestaetigt="rueckgaengig"
    />
  </LayoutEinstellungsSeite>
</template>
