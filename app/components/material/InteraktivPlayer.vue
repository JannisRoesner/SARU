<script setup lang="ts">
import {
  erklaerungFuerFrame,
  parseSwfKopf,
  parseSwfMetadaten,
  type InteraktivMetadaten,
} from '#shared/utils/interaktiv'

/**
 * Spielt eine SWF-Animation per Ruffle in einem abgeschotteten iframe (ohne `allow-same-origin`)
 * ab. Die Datei wird hier geladen und per postMessage übergeben; Steuerung und Haltepunkte
 * laufen über dieselbe Nachrichtenbrücke. Die Elemente in der SWF bedient Ruffle selbst.
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

function sende(cmd: string, daten: Record<string, unknown> = {}, transfer: Transferable[] = []) {
  rahmen.value?.contentWindow?.postMessage({ saru: 'cmd', cmd, ...daten }, '*', transfer)
}

/**
 * Dokument des iframes: Ruffle-Player plus Brücke für `swfStopped` und Befehle.
 * Der iframe hat keine eigene Herkunft und lädt selbst nichts nach – Ruffle-Skript und
 * WebAssembly holt die Elternseite und reicht sie per Nachricht durch (`fetch` wird umgeleitet).
 */
function rahmenDokument(origin: string): string {
  const ruffle = `${origin}/ruffle/`
  const skript = `
    window.RufflePlayer = window.RufflePlayer || {};
    window.RufflePlayer.config = {
      publicPath: ${JSON.stringify(ruffle)},
      allowScriptAccess: true,
      autoplay: 'on',
      unmuteOverlay: 'hidden',
      splashScreen: false,
      contextMenu: 'off',
      letterbox: 'on',
      warnOnUnsupportedContent: false,
      logLevel: 'warn'
    };
  `
  const brueke = `
    var player = null, daten = null, ruffleDa = false, anfragen = {}, zaehler = 0;
    function an(msg) { parent.postMessage(Object.assign({ saru: 'evt' }, msg), '*'); }
    window.addEventListener('error', function (e) { an({ type: 'warn', text: String(e.message) }); });
    window.swfStopped = function (frame) { an({ type: 'stopped', frame: Number(frame) }); };

    // Ruffle-Dateien kommen über die Elternseite.
    var echtesFetch = window.fetch;
    window.fetch = function (ziel) {
      var url = String(ziel && ziel.url ? ziel.url : ziel);
      if (url.indexOf(${JSON.stringify(ruffle)}) !== 0) return echtesFetch.apply(this, arguments);
      return new Promise(function (ok, nein) {
        var id = ++zaehler;
        anfragen[id] = { ok: ok, nein: nein, url: url };
        an({ type: 'abruf', id: id, url: url });
      });
    };

    function ext(name, arg) {
      try {
        var r = player && player.ruffle && player.ruffle();
        if (!r) return;
        if (arg === undefined) r.callExternalInterface(name); else r.callExternalInterface(name, arg);
      } catch (e) { an({ type: 'warn', text: String(e) }); }
    }
    function warteAufRuffle(versuch) {
      if (typeof window.RufflePlayer.newest === 'function') { ruffleDa = true; an({ type: 'ruffle-bereit' }); return; }
      if (versuch > 100) { an({ type: 'fehler', text: 'Ruffle nicht verfügbar' }); return; }
      setTimeout(function () { warteAufRuffle(versuch + 1); }, 50);
    }
    function start() {
      if (!ruffleDa || !daten) return;
      if (player) { player.remove(); player = null; }
      player = window.RufflePlayer.newest().createPlayer();
      player.style.cssText = 'width:100%;height:100%;display:block';
      document.getElementById('b').appendChild(player);
      player.addEventListener('loadedmovie', function () { try { player.focus(); } catch (e) {} an({ type: 'geladen' }); });
      player.load({ data: new Uint8Array(daten.slice(0)) }).catch(function (e) { an({ type: 'fehler', text: String(e) }); });
    }
    addEventListener('message', function (e) {
      var m = e.data;
      if (!m || m.saru !== 'cmd') return;
      if (m.cmd === 'ruffle') {
        var s = document.createElement('script');
        s.textContent = m.js;
        document.head.appendChild(s);
        warteAufRuffle(0);
      }
      else if (m.cmd === 'antwort') {
        var a = anfragen[m.id]; delete anfragen[m.id];
        if (!a) return;
        if (m.daten) a.ok(new Response(m.daten, { status: 200, headers: { 'content-type': 'application/wasm' } }));
        else a.nein(new TypeError('Abruf fehlgeschlagen: ' + a.url));
      }
      else if (m.cmd === 'laden') { daten = m.daten; start(); }
      else if (m.cmd === 'neustart') { start(); }
      else if (m.cmd === 'weiter') { if (player) player.play(); ext('swfPlay'); }
      else if (m.cmd === 'pause') { if (player) player.pause(); }
      else if (m.cmd === 'fortsetzen') { if (player) player.play(); }
      else if (m.cmd === 'erklaerung') { ext('swfSetExplanationMode', !!m.an); }
      else if (m.cmd === 'springen') { ext('swfGoto', m.frame); }
    });
    an({ type: 'bereit' });
  `
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<style>html,body{margin:0;height:100%;overflow:hidden;background:#fff}#b{width:100%;height:100%}</style>',
    '</head><body><div id="b"></div>',
    `<script>${skript}</` + 'script>',
    `<script>${brueke}</` + 'script>',
    '</body></html>',
  ].join('')
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
  }
}

function ladenInRahmen() {
  if (!bereit.value || !datenPuffer) return
  erstesAnhalten = true
  haltFrame.value = null
  pausiert.value = false
  const kopie = datenPuffer.slice(0)
  sende('laden', { daten: kopie }, [kopie])
}

async function datenLaden() {
  laedt.value = true
  fehler.value = null
  meta.value = null
  datenPuffer = null
  try {
    const puffer = await $fetch<ArrayBuffer>(props.src, { responseType: 'arrayBuffer' })
    datenPuffer = puffer
    const bytes = new Uint8Array(puffer)
    meta.value = parseSwfMetadaten(bytes)
    const kopf = parseSwfKopf(bytes)
    if (kopf) seitenverhaeltnis.value = `${kopf.breite} / ${kopf.hoehe}`
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
  dokument.value = rahmenDokument(window.location.origin)
  document.addEventListener('fullscreenchange', beiVollbildwechsel)
  void datenLaden()
})
onBeforeUnmount(() => {
  window.removeEventListener('message', beiNachricht)
  document.removeEventListener('fullscreenchange', beiVollbildwechsel)
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
      <iframe
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
      <UiToggle
        v-if="hatHaltepunkte"
        v-model="erklaerungenAn"
        label="Erklärtexte"
        class="ml-auto"
      />
    </div>

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
