<script setup lang="ts">
import {
  erklaerungFuerFrame,
  parseSwfKopf,
  parseSwfMetadaten,
  paketVerzeichnis,
  type InteraktivAktion,
  type InteraktivMetadaten,
} from '#shared/utils/interaktiv'
import { interaktivRahmenDokument } from '~/utils/interaktiv-rahmen'

/**
 * Spielt eine SWF-Animation per Ruffle in einem abgeschotteten iframe (ohne `allow-same-origin`)
 * ab. Die Datei wird hier geladen und per postMessage übergeben; Steuerung und Haltepunkte
 * laufen über dieselbe Nachrichtenbrücke. Die Elemente in der SWF bedient Ruffle selbst.
 * Paket-SWFs (Hülle mit Start-SWF und Nachbardateien, siehe `InteraktivPaket`) werden samt
 * Verzeichnis übergeben; der iframe beantwortet dann alle Ladeaufrufe aus dem Paket.
 */
const props = defineProps<{
  /** Adresse der SWF-Datei (Download-Endpunkt, ggf. mit `?inline=1`). */
  src: string
  titel?: string | null
  /** Füllt den verfügbaren Platz (Modal) statt ein festes Seitenverhältnis zu nutzen. */
  fuellend?: boolean
}>()

const wurzel = ref<HTMLElement | null>(null)
const rahmen = ref<HTMLIFrameElement | null>(null)

const laedt = ref(true)
const fehler = ref<string | null>(null)
const bereit = ref(false)
const meta = ref<InteraktivMetadaten | null>(null)
const seitenverhaeltnis = ref('4 / 3')
const pausiert = ref(false)
/** Aktueller Haltepunkt (Frame) – null, solange die Animation läuft. */
const haltFrame = ref<number | null>(null)
const vollbild = ref(false)
/** Bildzahl laut SWF-Kopf – Rückfall für den Schieber ohne `totalFrames`. */
const kopfBilder = ref(0)

const ERKLAERUNG_SCHLUESSEL = 'saru.interaktiv.erklaerungen'
const erklaerungenAn = ref(true)
// Erst nach dem Einhängen lesen, damit Server- und Client-Markup übereinstimmen.
function erklaerungenWahlLesen() {
  try {
    erklaerungenAn.value = localStorage.getItem(ERKLAERUNG_SCHLUESSEL) !== 'aus'
  } catch {
    // Speicher nicht verfügbar – Standard bleibt.
  }
}

const hatHaltepunkte = computed(() => Boolean(meta.value?.stopFrames.length))
/**
 * Erklärtext ohne Haltepunkt: Bei Schleifen-Abschnitten (z. B. „darm“) folgt auf „Weiter“ kein
 * swfStopped; der zweite Text mit gleichem Titel gehört dann zur Schleife.
 */
const schleifenIndex = ref<number | null>(null)
const erklaerung = computed(() => {
  if (!erklaerungenAn.value || !meta.value) return null
  if (schleifenIndex.value !== null) return meta.value.erklaerungen[schleifenIndex.value] ?? null
  return haltFrame.value !== null ? erklaerungFuerFrame(meta.value, haltFrame.value) : null
})

/** Umschalter-Zustand je Zusatzknopf (Index wie `meta.aktionen`). */
const umgeschaltet = ref<boolean[]>([])

function aktionLabel(aktion: InteraktivAktion, index: number): string {
  return aktion.umschalten && umgeschaltet.value[index] ? aktion.umschalten.label : aktion.label
}

function aktionAusfuehren(aktion: InteraktivAktion, index: number) {
  const zweiter = Boolean(aktion.umschalten && umgeschaltet.value[index])
  const arg = zweiter ? aktion.umschalten!.arg : aktion.arg
  sende('aufruf', arg === undefined ? { fn: aktion.fn } : { fn: aktion.fn, arg })
  if (aktion.umschalten) umgeschaltet.value[index] = !zweiter
}

/** Zeitleisten-Schieber: nur für SWFs, deren Metadaten ihn ausdrücklich anfordern. */
const schieberMax = computed(() =>
  meta.value?.schieber ? (meta.value.totalFrames ?? kopfBilder.value) : 0,
)
const schieberFrame = ref(1)
const schiebtGerade = ref(false)
let schieberTakt: ReturnType<typeof setInterval> | null = null

function schieberTaktStellen() {
  const aktiv = schieberMax.value > 1 && bereit.value && !laedt.value && !fehler.value
  if (aktiv && !schieberTakt) {
    schieberTakt = setInterval(() => {
      if (!schiebtGerade.value) sende('frame')
    }, 250)
  } else if (!aktiv && schieberTakt) {
    clearInterval(schieberTakt)
    schieberTakt = null
  }
}
watch([schieberMax, bereit, laedt, fehler], schieberTaktStellen)

function schieberBewegt(event: Event) {
  const frame = Number((event.target as HTMLInputElement).value)
  if (!Number.isInteger(frame) || frame < 1) return
  schieberFrame.value = frame
  sende('springen', { frame })
}

function sende(cmd: string, daten: Record<string, unknown> = {}, transfer: Transferable[] = []) {
  rahmen.value?.contentWindow?.postMessage({ saru: 'cmd', cmd, ...daten }, '*', transfer)
}

/** Ruffle-Dateien werden einmal geladen und für alle Player der Sitzung wiederverwendet. */
const ruffleCache = new Map<string, Promise<ArrayBuffer>>()
function ruffleDatei(url: string): Promise<ArrayBuffer> {
  // Nur Dateien direkt in /ruffle/ – der iframe ist nicht vertrauenswürdig (Pfade wie `/ruffle/../api` ausschließen).
  let ziel: URL
  try {
    ziel = new URL(url)
  } catch {
    return Promise.reject(new Error('Unzulässige Adresse'))
  }
  if (ziel.origin !== window.location.origin || !/^\/ruffle\/[\w.-]+$/.test(ziel.pathname) || ziel.pathname.includes('..')) {
    return Promise.reject(new Error('Unzulässige Adresse'))
  }
  let eintrag = ruffleCache.get(url)
  if (!eintrag) {
    eintrag = $fetch<ArrayBuffer>(url, { responseType: 'arrayBuffer' })
    eintrag.catch(() => ruffleCache.delete(url))
    ruffleCache.set(url, eintrag)
  }
  return eintrag
}

async function ruffleSenden() {
  try {
    const puffer = await ruffleDatei(`${window.location.origin}/ruffle/ruffle.js`)
    sende('ruffle', { js: new TextDecoder().decode(puffer) })
  } catch {
    fehler.value = 'Der Player konnte nicht geladen werden.'
    laedt.value = false
  }
}

async function abrufBeantworten(id: number, url: string) {
  try {
    const puffer = await ruffleDatei(url)
    const kopie = puffer.slice(0)
    sende('antwort', { id, daten: kopie }, [kopie])
  } catch {
    sende('antwort', { id })
  }
}

// Erst nach dem Einhängen setzen: auf dem Server ist die Herkunft unbekannt (Hydration).
const dokument = ref('')

let datenPuffer: ArrayBuffer | null = null
/** Paket-SWF: Start, Basis, FlashVars und Verzeichnis (Pfad → Bereich in `datenPuffer`). */
let paketDaten: {
  start: string
  basis: string
  parameter: Record<string, string>
  skalieren: boolean
  verzeichnis: Record<string, { o: number; l: number; t: string }>
} | null = null
let erstesAnhalten = true
let letzterHalt = { frame: -1, zeit: 0 }

function beiNachricht(event: MessageEvent) {
  if (event.source !== rahmen.value?.contentWindow) return
  const msg = event.data as {
    saru?: string
    type?: string
    frame?: number
    text?: string
    id?: number
    url?: string
  } | null
  if (msg?.saru !== 'evt') return
  switch (msg.type) {
    case 'bereit':
      void ruffleSenden()
      break
    case 'ruffle-bereit':
      bereit.value = true
      ladenInRahmen()
      break
    case 'abruf':
      if (msg.id !== undefined && msg.url) void abrufBeantworten(msg.id, msg.url)
      break
    case 'geladen':
      laedt.value = false
      rahmen.value?.focus()
      break
    case 'warn':
      console.warn('[Interaktiv]', msg.text)
      break
    case 'fehler':
      fehler.value = 'Der Inhalt konnte nicht abgespielt werden.'
      laedt.value = false
      break
    case 'stopped': {
      const frame = msg.frame ?? 1
      // Manche SWFs (Präsentation) melden jeden Seitenwechsel doppelt.
      const jetzt = Date.now()
      if (frame === letzterHalt.frame && jetzt - letzterHalt.zeit < 600) break
      letzterHalt = { frame, zeit: jetzt }
      schleifenIndex.value = null
      haltFrame.value = frame
      pausiert.value = false
      laedt.value = false
      // Erste Meldung nach dem Laden/Neustart: Haltepunkt-Modus einstellen; ohne Erklärtexte
      // läuft die Animation sofort weiter.
      if (erstesAnhalten) {
        erstesAnhalten = false
        // Ohne diese Meldung reagiert die SWF nicht auf „Weiter“ (swfPlay).
        sende('erklaerung', { an: erklaerungenAn.value })
        if (!erklaerungenAn.value) {
          haltFrame.value = null
          sende('weiter')
        }
      }
      break
    }
    case 'frame':
      if (!schiebtGerade.value && msg.frame !== undefined && msg.frame >= 1) schieberFrame.value = msg.frame
      break
  }
}

function ladenInRahmen() {
  if (!bereit.value || !datenPuffer) return
  erstesAnhalten = true
  haltFrame.value = null
  pausiert.value = false
  umgeschaltet.value = []
  schieberFrame.value = 1
  const kopie = datenPuffer.slice(0)
  sende('laden', { daten: kopie, paket: paketDaten }, [kopie])
}

async function datenLaden() {
  laedt.value = true
  fehler.value = null
  meta.value = null
  kopfBilder.value = 0
  datenPuffer = null
  paketDaten = null
  try {
    const puffer = await $fetch<ArrayBuffer>(props.src, { responseType: 'arrayBuffer' })
    datenPuffer = puffer
    const bytes = new Uint8Array(puffer)
    meta.value = parseSwfMetadaten(bytes)
    const paket = meta.value?.paket
    paketDaten = paket
      ? { start: paket.start, basis: paket.basis, parameter: { ...paket.parameter }, skalieren: paket.skalieren, verzeichnis: paketVerzeichnis(bytes, paket) }
      : null
    const kopf = parseSwfKopf(bytes)
    if (kopf) {
      seitenverhaeltnis.value = `${kopf.breite} / ${kopf.hoehe}`
      kopfBilder.value = kopf.bilder
    }
    ladenInRahmen()
  } catch {
    fehler.value = 'Die Datei konnte nicht geladen werden.'
    laedt.value = false
  }
}

function weiter() {
  const m = meta.value
  const index = m && haltFrame.value !== null ? m.stopFrames.indexOf(haltFrame.value) : -1
  const aktuell = index >= 0 ? m!.erklaerungen[index] : null
  const naechste = index >= 0 ? m!.erklaerungen[index + 1] : null
  schleifenIndex.value
    = aktuell && naechste && aktuell.title && aktuell.title === naechste.title ? index + 1 : null
  haltFrame.value = null
  pausiert.value = false
  sende('weiter')
}

function pauseUmschalten() {
  pausiert.value = !pausiert.value
  sende(pausiert.value ? 'pause' : 'fortsetzen')
}

function neustart() {
  schleifenIndex.value = null
  letzterHalt = { frame: -1, zeit: 0 }
  erstesAnhalten = true
  haltFrame.value = null
  pausiert.value = false
  umgeschaltet.value = []
  schieberFrame.value = 1
  sende('neustart')
}

watch(erklaerungenAn, (an) => {
  try {
    localStorage.setItem(ERKLAERUNG_SCHLUESSEL, an ? 'an' : 'aus')
  } catch {
    // ohne Speicher gilt die Wahl nur für diese Ansicht
  }
  sende('erklaerung', { an })
  // Wurde während eines Haltepunkts ausgeschaltet, läuft die Animation weiter.
  if (!an && haltFrame.value !== null) weiter()
})

async function vollbildUmschalten() {
  const el = wurzel.value
  if (!el) return
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await el.requestFullscreen()
  } catch {
    // Vollbild wird vom Browser nicht erlaubt – Ansicht bleibt unverändert.
  }
}

function beiVollbildwechsel() {
  vollbild.value = document.fullscreenElement === wurzel.value
}

onMounted(() => {
  erklaerungenWahlLesen()
  window.addEventListener('message', beiNachricht)
  dokument.value = interaktivRahmenDokument(window.location.origin)
  document.addEventListener('fullscreenchange', beiVollbildwechsel)
  void datenLaden()
})
onBeforeUnmount(() => {
  window.removeEventListener('message', beiNachricht)
  document.removeEventListener('fullscreenchange', beiVollbildwechsel)
  if (schieberTakt) clearInterval(schieberTakt)
})
watch(() => props.src, () => void datenLaden())

const buehneStil = computed(() =>
  props.fuellend || vollbild.value ? undefined : { aspectRatio: seitenverhaeltnis.value, maxHeight: '75vh' },
)
</script>

<template>
  <div
    ref="wurzel"
    class="flex min-h-0 w-full flex-col gap-2 rounded-xl bg-surface p-2 text-ink"
    :class="[(fuellend || vollbild) && 'h-full', vollbild && 'rounded-none']"
  >
    <div
      class="relative min-h-0 w-full overflow-hidden rounded-lg border border-line bg-white"
      :class="(fuellend || vollbild) && 'flex-1'"
      :style="buehneStil"
    >
      <!-- Erst mit fertigem srcdoc einfügen: Wird das srcdoc eines schon eingehängten, abgeschotteten iframes
           gesetzt, bleibt sein Inhalt in Chrome (ab ~152) oft 0×0 groß – die Bühne bleibt weiß. -->
      <iframe
        v-if="dokument"
        ref="rahmen"
        :srcdoc="dokument"
        sandbox="allow-scripts allow-pointer-lock"
        allow="fullscreen; autoplay"
        class="block size-full border-0"
        :title="titel || 'Interaktiver Inhalt'"
      />
      <div
        v-if="laedt || fehler"
        class="absolute inset-0 flex items-center justify-center bg-surface/80 p-4 text-center text-sm text-ink-muted"
      >
        <span v-if="fehler" class="text-danger">{{ fehler }}</span>
        <span v-else>Interaktiver Inhalt wird geladen …</span>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <UiButton
        groesse="lg"
        :icon="pausiert ? 'play' : 'pause'"
        :disabled="haltFrame !== null"
        @click="pauseUmschalten"
      >
        {{ pausiert ? 'Weiter abspielen' : 'Pause' }}
      </UiButton>
      <UiButton
        v-if="haltFrame !== null"
        variante="primaer"
        groesse="lg"
        icon-rechts="forward-step"
        @click="weiter"
      >
        Weiter
      </UiButton>
      <UiButton groesse="lg" icon="rotate-left" @click="neustart">Neustart</UiButton>
      <UiButton groesse="lg" :icon="vollbild ? 'compress' : 'expand'" @click="vollbildUmschalten">
        {{ vollbild ? 'Vollbild beenden' : 'Vollbild' }}
      </UiButton>
      <UiButton
        v-for="(aktion, index) in meta?.aktionen ?? []"
        :key="index"
        groesse="lg"
        @click="aktionAusfuehren(aktion, index)"
      >
        {{ aktionLabel(aktion, index) }}
      </UiButton>
      <UiToggle
        v-if="hatHaltepunkte"
        v-model="erklaerungenAn"
        label="Erklärtexte"
        class="ml-auto"
      />
    </div>

    <label v-if="schieberMax > 1" class="flex items-center gap-3 px-1 text-sm text-ink-muted">
      <span class="shrink-0">Zeitleiste</span>
      <input
        type="range"
        min="1"
        :max="schieberMax"
        step="1"
        :value="schieberFrame"
        :disabled="laedt || Boolean(fehler)"
        class="min-w-0 flex-1 accent-[var(--color-primary)]"
        aria-label="Zeitleiste der Animation"
        @pointerdown="schiebtGerade = true"
        @pointerup="schiebtGerade = false"
        @pointercancel="schiebtGerade = false"
        @change="schiebtGerade = false"
        @input="schieberBewegt"
      >
      <span class="w-16 shrink-0 text-right tabular-nums">{{ schieberFrame }} / {{ schieberMax }}</span>
    </label>

    <div
      v-if="erklaerung"
      class="rounded-lg border border-line bg-surface-hover px-4 py-3"
      aria-live="polite"
    >
      <p v-if="erklaerung.title" class="font-medium text-ink">{{ erklaerung.title }}</p>
      <p v-if="erklaerung.text" class="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink-muted">
        {{ erklaerung.text }}
      </p>
    </div>
  </div>
</template>
