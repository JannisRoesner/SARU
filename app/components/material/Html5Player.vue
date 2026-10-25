<script setup lang="ts">
/**
 * Zeigt ein HTML5-Paket (.html5.zip, z. B. Klett-Tafelbild) in einem abgeschotteten iframe
 * (ohne `allow-same-origin`). Der Server liefert die Dateien einzeln aus dem ZIP; die
 * Startadresse enthält einen befristeten Zugriffsschlüssel, weil der iframe keine Cookies sendet.
 */
const props = defineProps<{
  /** Endpunkt, der die Startadresse liefert (`…/dateien/<id>/html5`). */
  quelle: string
  titel?: string | null
  /** Füllt den verfügbaren Platz (Modal) statt ein festes Seitenverhältnis zu nutzen. */
  fuellend?: boolean
}>()

interface Buehne {
  breite: number
  /** null: nur die Breite einpassen, die Höhe folgt der Fläche. */
  hoehe: number | null
}

const wurzel = ref<HTMLElement | null>(null)
const flaeche = ref<HTMLElement | null>(null)
const adresse = ref<string | null>(null)
/** Feste Bühnengröße des Pakets (Manifest oder Viewport-Angabe); null = iframe füllt die Fläche. */
const buehne = ref<Buehne | null>(null)
const flaecheGroesse = ref({ breite: 0, hoehe: 0 })
const fehler = ref<string | null>(null)
const laedt = ref(true)
const vollbild = ref(false)
/** Wechselt beim Neustart, damit der iframe neu aufgebaut wird. */
const durchlauf = ref(0)

async function adresseLaden() {
  laedt.value = true
  fehler.value = null
  try {
    const antwort = await $fetch<{ url: string; buehne: Buehne | null }>(props.quelle)
    buehne.value = antwort.buehne
    adresse.value = antwort.url
  } catch {
    adresse.value = null
    fehler.value = 'Der interaktive Inhalt konnte nicht geladen werden.'
    laedt.value = false
  }
}

function neustart() {
  durchlauf.value += 1
  laedt.value = true
}

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

let beobachter: ResizeObserver | null = null

onMounted(() => {
  document.addEventListener('fullscreenchange', beiVollbildwechsel)
  beobachter = new ResizeObserver(([e]) => {
    if (e) flaecheGroesse.value = { breite: e.contentRect.width, hoehe: e.contentRect.height }
  })
  if (flaeche.value) beobachter.observe(flaeche.value)
  void adresseLaden()
})
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', beiVollbildwechsel)
  beobachter?.disconnect()
})
watch(() => props.quelle, () => void adresseLaden())

const flaecheStil = computed(() => {
  if (props.fuellend || vollbild.value) return undefined
  const b = buehne.value
  return { aspectRatio: b?.hoehe ? `${b.breite} / ${b.hoehe}` : '4 / 3', maxHeight: '75vh' }
})

/** Inhalte mit fester Größe (Tafelbilder) wie auf einer Leinwand einpassen. */
const rahmenStil = computed(() => {
  const b = buehne.value
  const { breite, hoehe } = flaecheGroesse.value
  if (!b || !breite || !hoehe) return undefined
  const faktor = b.hoehe ? Math.min(breite / b.breite, hoehe / b.hoehe) : breite / b.breite
  const bHoehe = b.hoehe ?? hoehe / faktor
  return {
    width: `${b.breite}px`,
    height: `${bHoehe}px`,
    position: 'absolute' as const,
    left: `${(breite - b.breite * faktor) / 2}px`,
    top: `${(hoehe - bHoehe * faktor) / 2}px`,
    transform: `scale(${faktor})`,
    transformOrigin: '0 0',
  }
})
</script>

<template>
  <div
    ref="wurzel"
    class="flex min-h-0 w-full flex-col gap-2 rounded-xl bg-surface p-2 text-ink"
    :class="[(fuellend || vollbild) && 'h-full', vollbild && 'rounded-none']"
  >
    <div
      ref="flaeche"
      class="relative min-h-0 w-full overflow-hidden rounded-lg border border-line bg-white"
      :class="(fuellend || vollbild) && 'flex-1'"
      :style="flaecheStil"
    >
      <iframe
        v-if="adresse"
        :key="durchlauf"
        :src="adresse"
        sandbox="allow-scripts allow-popups allow-forms allow-modals allow-pointer-lock"
        allow="fullscreen; autoplay"
        referrerpolicy="no-referrer"
        class="block size-full border-0"
        :style="rahmenStil"
        :title="titel || 'Interaktiver Inhalt'"
        @load="laedt = false"
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
      <UiButton groesse="lg" icon="rotate-left" :disabled="!adresse" @click="neustart">Neustart</UiButton>
      <UiButton groesse="lg" :icon="vollbild ? 'compress' : 'expand'" @click="vollbildUmschalten">
        {{ vollbild ? 'Vollbild beenden' : 'Vollbild' }}
      </UiButton>
    </div>
  </div>
</template>
