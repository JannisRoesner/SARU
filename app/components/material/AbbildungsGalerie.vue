<script setup lang="ts">
import { abbildungFundstelle } from '#shared/utils/abbildungen'

/**
 * Galerie einer Abbildungssammlung mit Großansicht. Gemeinsam für die Materialseite und
 * Freigabe-Links; die Adressen kommen als Props, die Rechte liefert die Liste selbst.
 * Große Sammlungen (1.000+ Bilder) bleiben flüssig: Miniaturen laden erst im Sichtbereich,
 * und die Kacheln werden abschnittsweise gerendert.
 */
const props = withDefaults(
  defineProps<{
    /** GET: Liste der Bilder. */
    listeUrl: string
    /** Basis der Datei-Endpunkte (`/api/assets` bzw. `/api/geteilt/<schlüssel>/dateien`). */
    dateiBasis: string
    /** Basis zum Ändern einzelner Bilder (`/api/abbildungen` bzw. `/api/geteilt/<schlüssel>/abbildungen`). */
    abbildungBasis: string
    /** POST: Bilder hinzufügen (multipart). */
    hochladenUrl?: string | null
    /** ZIP der ganzen Sammlung. */
    zipUrl: string
    /** POST startet, DELETE bricht die KI-Ergänzung ab (nur angemeldet). */
    kiUrl?: string | null
    /** Bild, das beim Öffnen gleich groß gezeigt wird (z. B. aus einem Suchtreffer). */
    startId?: string | null
    /** Löschen einzelner Bilder (nur angemeldet). */
    loeschenErlaubt?: boolean
  }>(),
  { hochladenUrl: null, kiUrl: null, startId: null, loeschenErlaubt: false },
)

const emit = defineEmits<{ geaendert: [] }>()

interface Abbildung {
  id: string
  assetId: string
  fileName: string | null
  mimeType: string | null
  sizeBytes: number | null
  titel: string
  beschreibung: string | null
  werk: string | null
  seite: string | null
  abbildung: string | null
  kapitel: string | null
  schlagwoerter: string[]
  beschriftet: boolean | null
  varianteVon: string | null
  original: string | null
  reihenfolge: number
  herkunft?: string
  ki?: { model?: string; generatedAt?: string } | null
}

interface Liste {
  abbildungen: Abbildung[]
  darfBearbeiten: boolean
  ki?: {
    verfuegbar: boolean
    ohneAngaben: number
    fortschritt: { gesamt: number; fertig: number; ergaenzt: number; fehler: number; laeuft: boolean; meldung: string | null } | null
  }
}

const { aufruf, laeuft } = useApi()
const route = useRoute()
const router = useRouter()

const { data, error, refresh, status } = await useFetch<Liste>(() => props.listeUrl, { key: `abbildungen:${props.listeUrl}` })

const alle = computed(() => data.value?.abbildungen ?? [])
const darfBearbeiten = computed(() => Boolean(data.value?.darfBearbeiten))

const variantenVon = computed(() => {
  const map = new Map<string, Abbildung[]>()
  for (const bild of alle.value) {
    if (!bild.varianteVon) continue
    map.set(bild.varianteVon, [...(map.get(bild.varianteVon) ?? []), bild])
  }
  return map
})
const hauptbilder = computed(() => alle.value.filter((bild) => !bild.varianteVon || !alle.value.some((b) => b.id === bild.varianteVon)))

// --- Filter ------------------------------------------------------------------------
const suche = ref('')
const kapitelFilter = ref<string | null>(null)
const kapitelListe = computed(() =>
  [...new Set(hauptbilder.value.map((b) => b.kapitel).filter((k): k is string => Boolean(k)))].sort((a, b) =>
    a.localeCompare(b, 'de', { numeric: true }),
  ),
)
function suchtext(bild: Abbildung): string {
  return [bild.titel, bild.beschreibung, bild.kapitel, bild.werk, bild.seite, bild.abbildung, bild.fileName, ...bild.schlagwoerter]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}
const gefiltert = computed(() => {
  const woerter = suche.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return hauptbilder.value.filter(
    (bild) =>
      (!kapitelFilter.value || bild.kapitel === kapitelFilter.value) &&
      woerter.every((wort) => suchtext(bild).includes(wort)),
  )
})

// --- Abschnittsweises Rendern ----------------------------------------------------------
const SCHRITT = 120
const sichtbar = ref(SCHRITT)
watch([suche, kapitelFilter], () => (sichtbar.value = SCHRITT))
const angezeigt = computed(() => gefiltert.value.slice(0, sichtbar.value))
const ende = ref<HTMLElement | null>(null)
let beobachter: IntersectionObserver | null = null
onMounted(() => {
  beobachter = new IntersectionObserver(
    (eintraege) => {
      if (eintraege.some((e) => e.isIntersecting) && sichtbar.value < gefiltert.value.length) sichtbar.value += SCHRITT
    },
    { rootMargin: '600px' },
  )
  watchEffect(() => {
    beobachter?.disconnect()
    if (ende.value) beobachter?.observe(ende.value)
  })
})
onBeforeUnmount(() => beobachter?.disconnect())

const fehlerhafteMiniaturen = ref(new Set<string>())
function miniaturUrl(bild: Abbildung) {
  return `${props.dateiBasis}/${bild.assetId}/thumbnail`
}
function bildUrl(bild: Abbildung) {
  return `${props.dateiBasis}/${bild.assetId}/download?inline=1`
}
function herunterladen(bild: Abbildung) {
  window.open(`${props.dateiBasis}/${bild.assetId}/download`, '_blank')
}
function zipHerunterladen() {
  window.open(props.zipUrl, '_blank')
}

// --- Großansicht -------------------------------------------------------------------------
const offenId = ref<string | null>(null)
/** Gezeigte Fassung (Hauptbild oder Variante) innerhalb der Großansicht. */
const fassungId = ref<string | null>(null)
const offenIndex = computed(() => gefiltert.value.findIndex((b) => b.id === offenId.value))
const offenBild = computed(() => hauptbilder.value.find((b) => b.id === offenId.value) ?? null)
const fassungen = computed(() => (offenBild.value ? [offenBild.value, ...(variantenVon.value.get(offenBild.value.id) ?? [])] : []))
const gezeigt = computed(() => fassungen.value.find((f) => f.id === fassungId.value) ?? offenBild.value)

function fassungLabel(bild: Abbildung, index: number): string {
  if (bild.beschriftet === true) return 'Beschriftet'
  if (bild.beschriftet === false) return 'Unbeschriftet'
  return index === 0 ? 'Original' : `Fassung ${index + 1}`
}

function oeffnen(id: string) {
  const bild = alle.value.find((b) => b.id === id)
  if (!bild) return
  const haupt = bild.varianteVon && alle.value.some((b) => b.id === bild.varianteVon) ? bild.varianteVon : bild.id
  offenId.value = haupt
  fassungId.value = bild.id
  bearbeiten.value = false
}
function schliessen() {
  offenId.value = null
  fassungId.value = null
}
function blaettern(richtung: 1 | -1) {
  if (!gefiltert.value.length) return
  const index = offenIndex.value < 0 ? 0 : (offenIndex.value + richtung + gefiltert.value.length) % gefiltert.value.length
  oeffnen(gefiltert.value[index]!.id)
}

// Die Adresse zeigt die gezeigte Fassung – so lässt sich ein Bild direkt verlinken.
watch([offenId, fassungId], ([id]) => {
  if (!import.meta.client) return
  document.body.style.overflow = id ? 'hidden' : ''
  const query = { ...route.query }
  if (id) query.abbildung = fassungId.value ?? id
  else delete query.abbildung
  void router.replace({ query })
})

function beiTaste(event: KeyboardEvent) {
  if (!offenId.value || bearbeiten.value) return
  if (event.key === 'Escape') schliessen()
  else if (event.key === 'ArrowRight') blaettern(1)
  else if (event.key === 'ArrowLeft') blaettern(-1)
}
onMounted(() => {
  document.addEventListener('keydown', beiTaste)
  const start = props.startId ?? (typeof route.query.abbildung === 'string' ? route.query.abbildung : null)
  if (start) oeffnen(start)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', beiTaste)
  document.body.style.overflow = ''
})

// --- Bearbeiten ----------------------------------------------------------------------------
const bearbeiten = ref(false)
const formular = reactive({
  titel: '',
  beschreibung: '',
  kapitel: '',
  werk: '',
  seite: '',
  abbildung: '',
  schlagwoerter: [] as string[],
  beschriftet: 'unbekannt' as 'ja' | 'nein' | 'unbekannt',
})
function bearbeitenStarten() {
  const bild = gezeigt.value
  if (!bild) return
  Object.assign(formular, {
    titel: bild.titel,
    beschreibung: bild.beschreibung ?? '',
    kapitel: bild.kapitel ?? '',
    werk: bild.werk ?? '',
    seite: bild.seite ?? '',
    abbildung: bild.abbildung ?? '',
    schlagwoerter: [...bild.schlagwoerter],
    beschriftet: bild.beschriftet === true ? 'ja' : bild.beschriftet === false ? 'nein' : 'unbekannt',
  })
  bearbeiten.value = true
}
async function speichern() {
  const bild = gezeigt.value
  if (!bild) return
  const ok = await aufruf(`${props.abbildungBasis}/${bild.id}`, {
    method: 'PATCH',
    body: {
      titel: formular.titel,
      beschreibung: formular.beschreibung || null,
      kapitel: formular.kapitel || null,
      werk: formular.werk || null,
      seite: formular.seite || null,
      abbildung: formular.abbildung || null,
      schlagwoerter: formular.schlagwoerter,
      beschriftet: formular.beschriftet === 'unbekannt' ? null : formular.beschriftet === 'ja',
    },
    erfolgsmeldung: 'Angaben gespeichert.',
  })
  if (ok) {
    bearbeiten.value = false
    await refresh()
  }
}

const loeschenOffen = ref(false)
async function loeschen() {
  const bild = gezeigt.value
  if (!bild) return
  const ok = await aufruf(`${props.abbildungBasis}/${bild.id}`, { method: 'DELETE', erfolgsmeldung: 'Bild entfernt.' })
  loeschenOffen.value = false
  if (ok) {
    schliessen()
    await refresh()
    emit('geaendert')
  }
}

// --- Hinzufügen ------------------------------------------------------------------------------
const dateiInput = ref<HTMLInputElement | null>(null)
const uploadHinweise = ref<string[]>([])
async function hochladen(files: FileList | null) {
  if (!files?.length || !props.hochladenUrl) return
  const body = new FormData()
  for (const datei of Array.from(files)) body.append('files', datei, datei.name)
  const ergebnis = await aufruf<{ angelegt: unknown[]; uebersprungen: { dateiName: string; grund: string }[]; warnungen: string[] }>(
    props.hochladenUrl,
    { method: 'POST', body },
  )
  if (dateiInput.value) dateiInput.value.value = ''
  if (!ergebnis) return
  uploadHinweise.value = [
    `${ergebnis.angelegt.length} Bild${ergebnis.angelegt.length === 1 ? '' : 'er'} hinzugefügt.`,
    ...ergebnis.uebersprungen.map((u) => `${u.dateiName}: ${u.grund}`),
    ...ergebnis.warnungen,
  ]
  await refresh()
  emit('geaendert')
}

// --- KI-Ergänzung ------------------------------------------------------------------------------
const kiLaeuft = computed(() => Boolean(data.value?.ki?.fortschritt?.laeuft))
async function kiStarten() {
  if (!props.kiUrl) return
  const ok = await aufruf(props.kiUrl, { method: 'POST', erfolgsmeldung: 'KI-Ergänzung gestartet.' })
  if (ok) await refresh()
}
async function kiAbbrechen() {
  if (!props.kiUrl) return
  await aufruf(props.kiUrl, { method: 'DELETE', erfolgsmeldung: 'KI-Ergänzung wird abgebrochen.' })
  await refresh()
}
let kiPoll: ReturnType<typeof setInterval> | undefined
watch(
  kiLaeuft,
  (an) => {
    if (kiPoll) clearInterval(kiPoll)
    kiPoll = an && import.meta.client ? setInterval(() => void refresh(), 3000) : undefined
  },
  { immediate: true },
)
onBeforeUnmount(() => kiPoll && clearInterval(kiPoll))
</script>

<template>
  <div>
    <UiFehlerzustand v-if="error" :text="toApiFehler(error).nachricht" @erneut="refresh()" />
    <UiSkelett v-else-if="status === 'pending' && !data" art="liste" :zeilen="3" />
    <template v-else>
      <div class="mb-4 flex flex-wrap items-end gap-3">
        <UiField label="Bilder filtern" class="min-w-48 flex-1">
          <UiInput v-model="suche" icon="magnifying-glass" placeholder="Titel, Schlagwort, Seite …" />
        </UiField>
        <UiField v-if="kapitelListe.length > 1" label="Kapitel" class="w-56">
          <UiSelect
            v-model="kapitelFilter"
            platzhalter="Alle Kapitel"
            :optionen="kapitelListe.map((k) => ({ value: k, label: k }))"
          />
        </UiField>
        <div class="flex flex-wrap gap-2">
          <UiButton variante="sekundaer" icon="file-zipper" :disabled="!alle.length" @click="zipHerunterladen">
            Alle als ZIP
          </UiButton>
          <template v-if="darfBearbeiten && hochladenUrl">
            <input
              ref="dateiInput"
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.webp,.gif,.json,image/png,image/jpeg,image/webp,image/gif"
              class="sr-only"
              @change="hochladen(($event.target as HTMLInputElement).files)"
            >
            <UiButton variante="sekundaer" icon="cloud-arrow-up" :laedt="laeuft" @click="dateiInput?.click()">
              Bilder hinzufügen
            </UiButton>
          </template>
        </div>
      </div>

      <p class="mb-3 text-sm text-ink-muted">
        {{ formatZahl(gefiltert.length) }} von {{ formatZahl(hauptbilder.length) }} Bildern
        <template v-if="alle.length > hauptbilder.length"> · {{ formatZahl(alle.length - hauptbilder.length) }} Varianten</template>
      </p>

      <ul v-if="uploadHinweise.length" class="mb-4 space-y-0.5 rounded-lg bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
        <li v-for="(h, i) in uploadHinweise" :key="i">{{ h }}</li>
      </ul>

      <div
        v-if="darfBearbeiten && kiUrl && data?.ki?.verfuegbar && (data.ki.ohneAngaben || kiLaeuft)"
        class="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-sunken/60 px-4 py-3 text-sm"
      >
        <UiIcon :name="kiLaeuft ? 'circle-notch' : 'wand-magic-sparkles'" :dreht="kiLaeuft" fest class="text-primary" />
        <span v-if="kiLaeuft && data.ki.fortschritt" class="min-w-0 flex-1">
          KI ergänzt Bildangaben: {{ data.ki.fortschritt.fertig }} von {{ data.ki.fortschritt.gesamt }} bearbeitet.
        </span>
        <span v-else class="min-w-0 flex-1">
          {{ formatZahl(data.ki.ohneAngaben) }} Bilder haben nur Angaben aus dem Dateinamen. Die Vision-KI kann Titel,
          Beschreibung und Schlagwörter vorschlagen (verkleinerte Bilder, in Stapeln).
          <span v-if="data.ki.fortschritt?.meldung" class="block text-xs text-warning">{{ data.ki.fortschritt.meldung }}</span>
        </span>
        <UiButton v-if="kiLaeuft" variante="sekundaer" groesse="sm" icon="stop" @click="kiAbbrechen">Abbrechen</UiButton>
        <UiButton v-else variante="sekundaer" groesse="sm" icon="wand-magic-sparkles" :laedt="laeuft" @click="kiStarten">
          Per KI ergänzen
        </UiButton>
      </div>

      <UiLeerzustand
        v-if="!gefiltert.length"
        icon="images"
        :titel="alle.length ? 'Keine passenden Bilder' : 'Noch keine Bilder'"
        :text="alle.length ? 'Filter ändern oder leeren.' : 'Bilder über „Bilder hinzufügen“ oder den Stapel-Upload ergänzen.'"
      />
      <ul v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
        <li v-for="bild in angezeigt" :key="bild.id" class="galerie-kachel">
          <button
            type="button"
            class="group flex w-full flex-col overflow-hidden rounded-xl border border-line bg-surface text-left transition hover:border-primary/40 hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary"
            @click="oeffnen(bild.id)"
          >
            <span class="flex aspect-[4/3] items-center justify-center overflow-hidden bg-surface-sunken">
              <img
                v-if="!fehlerhafteMiniaturen.has(bild.id)"
                :src="miniaturUrl(bild)"
                :alt="bild.titel || bild.fileName || 'Abbildung'"
                loading="lazy"
                decoding="async"
                class="max-h-full max-w-full object-contain"
                @error="fehlerhafteMiniaturen.add(bild.id)"
              >
              <UiIcon v-else name="image" class="text-3xl text-ink-subtle" />
            </span>
            <span class="min-w-0 px-2.5 py-2">
              <span class="line-clamp-2 text-sm font-medium text-ink">{{ bild.titel || bild.fileName }}</span>
              <span class="flex items-center gap-1.5 truncate text-xs text-ink-subtle">
                <span class="truncate">{{ abbildungFundstelle(bild) || bild.kapitel || '\u00a0' }}</span>
                <UiIcon v-if="variantenVon.get(bild.id)?.length" name="clone" title="Mit Varianten" />
              </span>
            </span>
          </button>
        </li>
      </ul>
      <div ref="ende" aria-hidden="true" class="h-px" />
    </template>

    <Teleport to="body">
      <div
        v-if="offenBild && gezeigt"
        class="fixed inset-0 z-50 flex flex-col bg-slate-950/90 text-white lg:flex-row"
        role="dialog"
        aria-modal="true"
        :aria-label="gezeigt.titel || 'Abbildung'"
      >
        <div class="relative flex min-h-0 flex-1 items-center justify-center p-4">
          <img
            :key="gezeigt.id"
            :src="bildUrl(gezeigt)"
            :alt="gezeigt.titel || gezeigt.fileName || 'Abbildung'"
            class="max-h-full max-w-full rounded bg-white object-contain shadow-2xl"
          >
          <button
            type="button"
            class="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/40 p-3 hover:bg-black/60"
            title="Vorheriges Bild (←)"
            @click="blaettern(-1)"
          >
            <UiIcon name="chevron-left" fest />
          </button>
          <button
            type="button"
            class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/40 p-3 hover:bg-black/60"
            title="Nächstes Bild (→)"
            @click="blaettern(1)"
          >
            <UiIcon name="chevron-right" fest />
          </button>
        </div>

        <aside class="max-h-[45vh] w-full overflow-y-auto bg-surface p-5 text-ink lg:max-h-none lg:w-96">
          <div class="mb-3 flex items-start justify-between gap-2">
            <p class="text-xs text-ink-subtle">
              Bild {{ offenIndex + 1 }} von {{ gefiltert.length }}
            </p>
            <UiButton variante="still" groesse="sm" icon="xmark" nur-icon title="Schließen (Esc)" @click="schliessen" />
          </div>

          <div v-if="fassungen.length > 1" class="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Fassung">
            <button
              v-for="(fassung, index) in fassungen"
              :key="fassung.id"
              type="button"
              class="filter-chip"
              :class="fassung.id === gezeigt.id && 'filter-chip-aktiv'"
              @click="fassungId = fassung.id"
            >
              {{ fassungLabel(fassung, index) }}
            </button>
          </div>

          <form v-if="bearbeiten" class="space-y-3" @submit.prevent="speichern">
            <UiField label="Titel"><UiInput v-model="formular.titel" /></UiField>
            <UiField label="Beschreibung"><UiTextarea v-model="formular.beschreibung" :zeilen="3" /></UiField>
            <div class="grid grid-cols-2 gap-3">
              <UiField label="Kapitel"><UiInput v-model="formular.kapitel" /></UiField>
              <UiField label="Werk"><UiInput v-model="formular.werk" /></UiField>
              <UiField label="Seite"><UiInput v-model="formular.seite" /></UiField>
              <UiField label="Abbildung"><UiInput v-model="formular.abbildung" /></UiField>
            </div>
            <UiField label="Schlagwörter"><UiTagInput v-model="formular.schlagwoerter" :max="20" /></UiField>
            <UiField label="Beschriftung">
              <UiSelect
                v-model="formular.beschriftet"
                :optionen="[
                  { value: 'unbekannt', label: 'Unbekannt' },
                  { value: 'ja', label: 'Beschriftet' },
                  { value: 'nein', label: 'Unbeschriftet' },
                ]"
              />
            </UiField>
            <div class="flex justify-end gap-2">
              <UiButton variante="sekundaer" @click="bearbeiten = false">Abbrechen</UiButton>
              <UiButton type="submit" variante="primaer" icon="floppy-disk" :laedt="laeuft">Speichern</UiButton>
            </div>
          </form>

          <template v-else>
            <h2 class="text-lg font-semibold break-words">{{ gezeigt.titel || gezeigt.fileName }}</h2>
            <p v-if="abbildungFundstelle(gezeigt)" class="mt-1 text-sm text-ink-muted">{{ abbildungFundstelle(gezeigt) }}</p>
            <p v-if="gezeigt.kapitel" class="text-sm text-ink-muted">Kapitel: {{ gezeigt.kapitel }}</p>
            <p v-if="gezeigt.beschreibung" class="mt-3 text-sm whitespace-pre-line">{{ gezeigt.beschreibung }}</p>
            <div v-if="gezeigt.schlagwoerter.length" class="mt-3 flex flex-wrap gap-1">
              <UiBadge v-for="wort in gezeigt.schlagwoerter" :key="wort" groesse="sm" icon="tag">{{ wort }}</UiBadge>
            </div>
            <UiBadge v-if="gezeigt.herkunft === 'ki'" class="mt-3" ton="ki" icon="robot" groesse="sm">
              Angaben von KI{{ gezeigt.ki?.model ? ` (${gezeigt.ki.model})` : '' }}
            </UiBadge>
            <dl class="mt-4 space-y-1 text-xs text-ink-subtle">
              <div v-if="gezeigt.fileName"><dt class="inline">Datei: </dt><dd class="inline break-all">{{ gezeigt.fileName }}</dd></div>
              <div v-if="gezeigt.sizeBytes"><dt class="inline">Größe: </dt><dd class="inline">{{ formatBytes(gezeigt.sizeBytes) }}</dd></div>
              <div v-if="gezeigt.original"><dt class="inline">Original: </dt><dd class="inline break-all">{{ gezeigt.original }}</dd></div>
            </dl>
            <div class="mt-5 flex flex-wrap gap-2">
              <UiButton variante="primaer" icon="download" @click="herunterladen(gezeigt)">Herunterladen</UiButton>
              <UiButton v-if="darfBearbeiten" variante="sekundaer" icon="pen" @click="bearbeitenStarten">Bearbeiten</UiButton>
              <UiButton
                v-if="darfBearbeiten && loeschenErlaubt"
                variante="still"
                icon="trash"
                title="Bild entfernen"
                @click="loeschenOffen = true"
              >
                Entfernen
              </UiButton>
            </div>
          </template>
        </aside>
      </div>
    </Teleport>

    <UiConfirm
      v-model="loeschenOffen"
      gefahr
      titel="Bild entfernen?"
      text="Das Bild und seine Angaben werden aus der Sammlung gelöscht. Varianten bleiben als eigene Bilder erhalten."
      bestaetigen="Entfernen"
      @bestaetigt="loeschen"
    />
  </div>
</template>

<style scoped>
/* Kacheln außerhalb des Sichtbereichs nicht layouten – hält auch lange Listen flüssig. */
.galerie-kachel {
  content-visibility: auto;
  contain-intrinsic-size: auto 240px;
}
</style>
