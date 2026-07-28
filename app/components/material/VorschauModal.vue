<script setup lang="ts">
import type { AssetPreviewInfo } from '~~/server/services/preview.service'
import type {
  StoredSolutionAnswer,
  StoredStructuredSolution,
} from '~~/server/database/schema/materials'
import { overlayFieldType, overlayFontSizePx } from '#shared/utils/solution-overlay'

const offen = defineModel<boolean>({ required: true })

const props = defineProps<{
  assetId: string | null
  /** Optionaler Anzeigename, bis die API antwortet. */
  titel?: string | null
  /** KI-Musterlösung: strukturierte Antworten bearbeiten + Overlay neu zeichnen. */
  loesungBearbeiten?: boolean
  struktur?: StoredStructuredSolution | null
  /** Material-ID – lädt an PDF-Geometrie ausgerichtete bboxes für die Vorschau. */
  materialId?: string | null
  /** Quell-PDF für Seitenbild mit verschiebbaren Antwortboxen. */
  quellenAssetId?: string | null
  modellCredit?: string | null
  geprueft?: boolean
  darfBearbeiten?: boolean
  beiSpeichern?: (payload: {
    structuredSolution: StoredStructuredSolution
    reRender: boolean
    reviewed: boolean
  }) => void | Promise<void>
}>()

const emit = defineEmits<{
  herunterladen: [assetId: string]
}>()

const info = ref<AssetPreviewInfo | null>(null)
const laedt = ref(false)
const ladefehler = ref<unknown>(null)
const textInhalt = ref<string | null>(null)
const textFehler = ref(false)

const lokalStruktur = ref<StoredStructuredSolution | null>(null)
const aktiveAntwortId = ref<string | null>(null)
const seite = ref(1)
const lokalGeprueft = ref(false)
const drag = ref<{
  id: string
  art: 'move' | 'resize'
  startX: number
  startY: number
  orig: { x: number; y: number; w: number; h: number }
} | null>(null)
/** Verhindert, dass ein eigener Speichervorgang die lokale Bearbeitung zurücksetzt. */
const eigenesSpeichern = ref(false)
/** Struktur wird gerade geladen – Autosave unterdrücken. */
const strukturLaedt = ref(false)

const seitenFlaeche = ref<HTMLElement | null>(null)
const seitenHoehePx = ref(0)
let seitenResizeObserver: ResizeObserver | null = null

const { pdfIframeUnterstuetzt } = usePdfIframeVorschau()
/** Auf Smartphones kein iframe – Browser zeigen dort oft nur „Öffnen“ statt Inhalt. */
const pdfAlsSeitenbild = computed(() => !pdfIframeUnterstuetzt.value)
const pdfSeite = ref(1)
const pdfSeitenFehler = ref(false)

const pdfSeitenSkala = computed(() => {
  if (!import.meta.client) return 1.5
  return Math.min(2.5, Math.max(1.35, window.devicePixelRatio || 1.5))
})

const pdfSeitenBildUrl = computed(() => {
  if (!props.assetId || !pdfAlsSeitenbild.value || pdfSeitenFehler.value) return null
  return `/api/assets/${props.assetId}/page?page=${pdfSeite.value}&scale=${pdfSeitenSkala.value}`
})

const pdfLetzteSeite = computed(() => info.value?.pdfPageCount ?? null)

type LoesungAutosaveDaten = {
  structuredSolution: StoredStructuredSolution | null
  reviewed: boolean
}

const autosaveQuelle = computed<LoesungAutosaveDaten>(() => ({
  structuredSolution: lokalStruktur.value,
  reviewed: lokalGeprueft.value,
}))

const autosave = useAutosave(autosaveQuelle, {
  verzoegerungMs: 1400,
  gueltig: (daten) => {
    if (!offen.value || !props.loesungBearbeiten || !props.darfBearbeiten) return false
    if (!props.beiSpeichern || strukturLaedt.value) return false
    const struktur = daten.structuredSolution
    if (!struktur?.answers.length) return false
    // Während des Ziehens speichert der Debounce erst nach dem Loslassen
    // (jeder Move setzt den Timer zurück).
    if (drag.value) return false
    return struktur.answers.every((a) => a.answer.trim() && a.label.trim())
  },
  speichern: async (daten) => {
    if (!daten.structuredSolution || !props.beiSpeichern) return
    eigenesSpeichern.value = true
    try {
      await props.beiSpeichern({
        structuredSolution: daten.structuredSolution,
        reRender: true,
        reviewed: daten.reviewed,
      })
    } finally {
      // Parent-Refresh darf die lokale Struktur nicht überschreiben.
      await nextTick()
      eigenesSpeichern.value = false
    }
  },
})

async function laden() {
  if (!props.assetId) return
  laedt.value = true
  ladefehler.value = null
  info.value = null
  textInhalt.value = null
  textFehler.value = false
  try {
    info.value = await $fetch<AssetPreviewInfo>(`/api/assets/${props.assetId}/preview`)
    if (info.value.mode === 'text' && info.value.inlineUrl) {
      try {
        textInhalt.value = await $fetch<string>(info.value.inlineUrl, { responseType: 'text' })
      } catch {
        textFehler.value = true
      }
    }
  } catch (error) {
    ladefehler.value = error
  } finally {
    laedt.value = false
  }
}

function strukturAusProps() {
  if (!props.struktur) {
    lokalStruktur.value = null
    return
  }
  lokalStruktur.value = structuredClone(toRaw(props.struktur))
  lokalGeprueft.value = Boolean(props.geprueft)
  aktiveAntwortId.value = lokalStruktur.value.answers[0]?.id ?? null
  seite.value = lokalStruktur.value.answers[0]?.page ?? 1
}

async function strukturInitialisieren() {
  strukturLaedt.value = true
  try {
    strukturAusProps()
    if (!props.loesungBearbeiten || !props.materialId || !props.struktur) return
    try {
      const data = await $fetch<{ structuredSolution: StoredStructuredSolution }>(
        `/api/materials/${props.materialId}/solution`,
      )
      if (!data?.structuredSolution?.answers || !offen.value) return
      const aktive = aktiveAntwortId.value
      lokalStruktur.value = data.structuredSolution
      if (aktive && data.structuredSolution.answers.some((a) => a.id === aktive)) {
        aktiveAntwortId.value = aktive
      }
    } catch {
      // Fallback: props.struktur (Vision-bboxes) bleibt.
    }
  } finally {
    await nextTick()
    autosave.alsGespeichertMarkieren()
    strukturLaedt.value = false
  }
}

watch(offen, (istOffen) => {
  if (istOffen) {
    pdfSeite.value = 1
    pdfSeitenFehler.value = false
    void laden()
    void strukturInitialisieren()
  }
})

watch(
  () => props.assetId,
  () => {
    pdfSeite.value = 1
    pdfSeitenFehler.value = false
    if (offen.value) void laden()
  },
)

watch(pdfSeite, () => {
  pdfSeitenFehler.value = false
})

watch(
  () => props.struktur,
  () => {
    if (!offen.value || eigenesSpeichern.value) return
    const zustand = autosave.zustand.value
    if (zustand === 'geaendert' || zustand === 'speichert' || zustand === 'fehler') return
    void strukturInitialisieren()
  },
)

function seitenObserverAnbinden(el: HTMLElement | null) {
  seitenResizeObserver?.disconnect()
  seitenResizeObserver = null
  if (!el || typeof ResizeObserver === 'undefined') return
  seitenResizeObserver = new ResizeObserver((entries) => {
    const h = entries[0]?.contentRect.height ?? 0
    if (h > 0) seitenHoehePx.value = h
  })
  seitenResizeObserver.observe(el)
  const h = el.getBoundingClientRect().height
  if (h > 0) seitenHoehePx.value = h
}

watch(seitenFlaeche, (el) => seitenObserverAnbinden(el), { flush: 'post' })

const anzeigeTitel = computed(
  () => info.value?.title || props.titel || 'Dokumentvorschau',
)

const seitenBildUrl = computed(() => {
  const id = props.quellenAssetId || props.assetId
  if (!id || !props.loesungBearbeiten) return null
  return `/api/assets/${id}/page?page=${seite.value}`
})

const antwortenAufSeite = computed(() =>
  (lokalStruktur.value?.answers ?? []).filter((a) => (a.page || 1) === seite.value),
)

function herunterladen() {
  if (!props.assetId) return
  emit('herunterladen', props.assetId)
  window.open(`/api/assets/${props.assetId}/download`, '_blank')
}

function beiTaste(event: KeyboardEvent) {
  if (offen.value && event.key === 'Escape') {
    event.preventDefault()
    schliessen()
  }
}

function antwortFokussieren(id: string) {
  aktiveAntwortId.value = id
  const antwort = lokalStruktur.value?.answers.find((a) => a.id === id)
  if (antwort?.page) seite.value = antwort.page
  nextTick(() => {
    document.getElementById(`antwort-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}

function bboxVon(antwort: StoredSolutionAnswer) {
  const b = antwort.bbox
  return {
    x: b?.x ?? 0.35,
    y: b?.y ?? 0.2,
    w: b?.w ?? (antwort.fieldType === 'freitext' ? 0.45 : 0.28),
    h: b?.h ?? (antwort.fieldType === 'freitext' ? 0.08 : 0.028),
  }
}

function antwortTextStyle(antwort: StoredSolutionAnswer) {
  const box = bboxVon(antwort)
  const fieldType = overlayFieldType({
    fieldType: antwort.fieldType,
    bboxH: box.h,
    answer: antwort.answer,
  })
  const boxHeightPx = Math.max(8, box.h * (seitenHoehePx.value || 800))
  const fontSize = overlayFontSizePx(boxHeightPx, fieldType)
  return {
    '--pdf-font-size': `${fontSize}px`,
    '--pdf-line-gap': fieldType === 'freitext' ? '3px' : '2px',
  }
}

function antwortBoxAktualisieren(
  id: string,
  bbox: { x: number; y: number; w: number; h: number },
) {
  if (!lokalStruktur.value) return
  lokalStruktur.value = {
    ...lokalStruktur.value,
    answers: lokalStruktur.value.answers.map((a) =>
      a.id === id
        ? {
            ...a,
            page: seite.value,
            // Manuelle Position: Geometrie-Sync beim nächsten Öffnen nicht überschreiben.
            blankIndex: null,
            bbox: {
              x: clamp01(bbox.x),
              y: clamp01(bbox.y),
              w: clamp01(Math.max(0.04, bbox.w)),
              h: clamp01(Math.max(0.015, bbox.h)),
            },
          }
        : a,
    ),
  }
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n))
}

function dragStart(
  event: PointerEvent,
  antwort: StoredSolutionAnswer,
  art: 'move' | 'resize',
) {
  if (!props.darfBearbeiten) return
  event.preventDefault()
  event.stopPropagation()
  const box = bboxVon(antwort)
  aktiveAntwortId.value = antwort.id
  drag.value = {
    id: antwort.id,
    art,
    startX: event.clientX,
    startY: event.clientY,
    orig: box,
  }
  ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
}

function dragMove(event: PointerEvent) {
  if (!drag.value || !seitenFlaeche.value) return
  const rect = seitenFlaeche.value.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return
  const dx = (event.clientX - drag.value.startX) / rect.width
  const dy = (event.clientY - drag.value.startY) / rect.height
  const o = drag.value.orig
  if (drag.value.art === 'move') {
    antwortBoxAktualisieren(drag.value.id, {
      x: o.x + dx,
      y: o.y + dy,
      w: o.w,
      h: o.h,
    })
  } else {
    antwortBoxAktualisieren(drag.value.id, {
      x: o.x,
      y: o.y,
      w: o.w + dx,
      h: o.h + dy,
    })
  }
}

function dragEnd() {
  if (!drag.value) return
  drag.value = null
  // Timer kann während des Ziehens verfallen sein (gueltig = false) –
  // nach dem Loslassen erneut anstoßen.
  if (autosave.zustand.value === 'geaendert' || autosave.zustand.value === 'fehler') {
    void autosave.jetztSpeichern()
  }
}

async function aufSpeichernWarten() {
  // Laufenden Speichervorgang abwarten (jetztSpeichern kehrt bei 'speichert' sofort zurück).
  const start = Date.now()
  while (autosave.zustand.value === 'speichert' && Date.now() - start < 120_000) {
    await new Promise((r) => setTimeout(r, 50))
  }
  await autosave.jetztSpeichern()
  while (autosave.zustand.value === 'speichert' && Date.now() - start < 120_000) {
    await new Promise((r) => setTimeout(r, 50))
  }
}

async function schliessenMitSpeichern() {
  if (props.loesungBearbeiten && props.darfBearbeiten) {
    drag.value = null
    await aufSpeichernWarten()
    if (autosave.zustand.value === 'fehler' || autosave.zustand.value === 'geaendert') {
      return
    }
  }
  offen.value = false
}

function schliessen() {
  void schliessenMitSpeichern()
}

onMounted(() => document.addEventListener('keydown', beiTaste))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', beiTaste)
  seitenResizeObserver?.disconnect()
  seitenResizeObserver = null
  if (props.loesungBearbeiten && props.darfBearbeiten) {
    void autosave.jetztSpeichern()
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="offen"
        class="fixed inset-0 z-50 flex flex-col bg-slate-950/70 backdrop-blur-[2px]"
        role="dialog"
        aria-modal="true"
        :aria-label="anzeigeTitel"
      >
        <header class="flex shrink-0 items-center gap-3 border-b border-white/10 bg-slate-950/80 px-4 py-3 text-white">
          <UiIcon name="eye" class="text-white/70" />
          <div class="min-w-0 flex-1">
            <h2 class="truncate text-sm font-semibold sm:text-base">{{ anzeigeTitel }}</h2>
            <p v-if="info?.fileName" class="truncate text-xs text-white/60">{{ info.fileName }}</p>
          </div>
          <UiBadge v-if="modellCredit" ton="ki" icon="robot" class="!border-white/10">
            {{ modellCredit }}
          </UiBadge>
          <UiButton
            variante="sekundaer"
            groesse="sm"
            icon="download"
            class="!border-white/20 !bg-white/10 !text-white hover:!bg-white/20"
            @click="herunterladen"
          >
            Download
          </UiButton>
          <UiButton
            variante="still"
            groesse="sm"
            icon="xmark"
            nur-icon
            title="Schließen"
            class="!text-white hover:!bg-white/10"
            @click="schliessen"
          />
        </header>

        <!-- KI-Nachbearbeitung: Seite + Antwortliste -->
        <div
          v-if="loesungBearbeiten && lokalStruktur"
          class="flex min-h-0 flex-1 flex-col lg:flex-row"
        >
          <div class="relative flex min-h-0 min-w-0 flex-1 flex-col bg-slate-900/40 p-3">
            <div class="mb-2 flex flex-wrap items-center gap-2 text-white">
              <UiButton
                variante="still"
                groesse="sm"
                icon="chevron-left"
                nur-icon
                class="!text-white hover:!bg-white/10"
                :disabled="seite <= 1"
                @click="seite = Math.max(1, seite - 1)"
              />
              <span class="text-xs text-white/80">Seite {{ seite }}</span>
              <UiButton
                variante="still"
                groesse="sm"
                icon="chevron-right"
                nur-icon
                class="!text-white hover:!bg-white/10"
                @click="seite += 1"
              />
              <span class="text-[0.7rem] text-white/50">
                Boxen ziehen zum Verschieben, Ecke zum Vergrößern
              </span>
            </div>

            <div class="relative mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-auto">
              <div
                ref="seitenFlaeche"
                class="pdf-overlay-canvas relative mx-auto w-full overflow-hidden rounded-lg bg-white shadow-2xl"
                @pointermove="dragMove"
                @pointerup="dragEnd"
                @pointercancel="dragEnd"
              >
                <img
                  v-if="seitenBildUrl"
                  :src="seitenBildUrl"
                  alt="Arbeitsblatt-Seite"
                  class="block w-full select-none"
                  draggable="false"
                >
                <div
                  v-else
                  class="flex aspect-[210/297] items-center justify-center bg-surface text-sm text-ink-muted"
                >
                  Seitenbild nicht verfügbar
                </div>

                <button
                  v-for="antwort in antwortenAufSeite"
                  :key="antwort.id"
                  type="button"
                  class="pdf-antwort-box"
                  :class="{ 'pdf-antwort-box--aktiv': aktiveAntwortId === antwort.id }"
                  :style="{
                    left: `${bboxVon(antwort).x * 100}%`,
                    top: `${bboxVon(antwort).y * 100}%`,
                    width: `${bboxVon(antwort).w * 100}%`,
                    height: `${bboxVon(antwort).h * 100}%`,
                    ...antwortTextStyle(antwort),
                  }"
                  :title="antwort.label"
                  @click="antwortFokussieren(antwort.id)"
                  @pointerdown="dragStart($event, antwort, 'move')"
                >
                  <span class="pdf-antwort-box__text">{{ antwort.answer }}</span>
                  <span
                    v-if="darfBearbeiten"
                    class="pdf-antwort-box__griff"
                    @pointerdown.stop="dragStart($event, antwort, 'resize')"
                  />
                </button>
              </div>
            </div>
          </div>

          <aside class="flex w-full shrink-0 flex-col border-t border-white/10 bg-surface lg:w-[22rem] lg:border-t-0 lg:border-l lg:border-line">
            <div class="border-b border-line px-3 py-2">
              <p class="text-sm font-semibold text-ink">Antworten korrigieren</p>
              <p class="text-xs text-ink-muted">
                Änderungen werden automatisch gespeichert und ins PDF übernommen.
              </p>
            </div>
            <div class="min-h-0 flex-1 overflow-hidden p-3">
              <MaterialAntwortEditor
                v-model="lokalStruktur"
                :aktive-id="aktiveAntwortId"
                :disabled="!darfBearbeiten"
                @update:aktive-id="(id) => id && antwortFokussieren(id)"
              />
            </div>
            <div class="space-y-2 border-t border-line p-3">
              <UiToggle
                v-model="lokalGeprueft"
                label="Fachlich geprüft"
                hinweis="Als kontrollierte Musterlösung markieren."
                :disabled="!darfBearbeiten"
              />
              <UiSpeichernAnzeige
                v-if="darfBearbeiten"
                class="text-xs"
                :zustand="autosave.zustand.value"
                :fehler="autosave.letzterFehler.value"
                :zuletzt="autosave.zuletztGespeichert.value"
              />
            </div>
          </aside>
        </div>

        <!-- Standard-Vorschau -->
        <div
          v-else
          class="relative flex min-h-0 flex-1 items-center justify-center p-2 sm:p-4"
          @click.self="schliessen"
        >
          <div
            v-if="laedt"
            class="rounded-xl bg-surface px-6 py-8 text-sm text-ink-muted shadow-lg"
          >
            Vorschau wird geladen …
          </div>

          <div
            v-else-if="ladefehler || !info"
            class="max-w-md rounded-xl bg-surface px-6 py-8 text-center shadow-lg"
          >
            <UiIcon name="triangle-exclamation" class="mb-3 text-2xl text-warning" />
            <p class="font-medium text-ink">Vorschau nicht verfügbar</p>
            <p class="mt-2 text-sm text-ink-muted">
              {{ toApiFehler(ladefehler).nachricht || 'Die Datei konnte nicht geladen werden.' }}
            </p>
            <UiButton class="mt-4" variante="primaer" icon="download" @click="herunterladen">
              Herunterladen
            </UiButton>
          </div>

          <template v-else>
            <!-- PDF auf Mobile/Tablet: Seiten als PNG (iframe-PDF funktioniert dort nicht zuverlässig) -->
            <div
              v-if="info.mode === 'pdf' && pdfAlsSeitenbild"
              class="flex min-h-0 w-full max-w-3xl flex-1 flex-col"
            >
              <div class="mb-2 flex shrink-0 flex-wrap items-center justify-center gap-2 text-white">
                <UiButton
                  variante="still"
                  groesse="sm"
                  icon="chevron-left"
                  nur-icon
                  class="!text-white hover:!bg-white/10"
                  :disabled="pdfSeite <= 1"
                  title="Vorherige Seite"
                  @click="pdfSeite = Math.max(1, pdfSeite - 1)"
                />
                <span class="text-xs text-white/80">
                  Seite {{ pdfSeite }}<template v-if="pdfLetzteSeite"> / {{ pdfLetzteSeite }}</template>
                </span>
                <UiButton
                  variante="still"
                  groesse="sm"
                  icon="chevron-right"
                  nur-icon
                  class="!text-white hover:!bg-white/10"
                  :disabled="pdfLetzteSeite ? pdfSeite >= pdfLetzteSeite : false"
                  title="Nächste Seite"
                  @click="pdfSeite += 1"
                />
              </div>

              <div
                v-if="pdfSeitenFehler"
                class="max-w-md rounded-xl bg-surface px-6 py-8 text-center shadow-lg"
              >
                <UiIcon name="triangle-exclamation" class="mb-3 text-2xl text-warning" />
                <p class="font-medium text-ink">Seite konnte nicht geladen werden</p>
                <p class="mt-2 text-sm text-ink-muted">
                  Die PDF-Vorschau ist auf diesem Gerät eingeschränkt. Du kannst die Datei herunterladen
                  und in einer PDF-App öffnen.
                </p>
                <UiButton class="mt-4" variante="primaer" icon="download" @click="herunterladen">
                  Herunterladen
                </UiButton>
              </div>

              <div v-else class="min-h-0 flex-1 overflow-auto">
                <img
                  v-if="pdfSeitenBildUrl"
                  :key="pdfSeitenBildUrl"
                  :src="pdfSeitenBildUrl"
                  :alt="`${anzeigeTitel} – Seite ${pdfSeite}`"
                  class="mx-auto block w-full rounded-lg bg-white shadow-2xl"
                  @error="pdfSeitenFehler = true"
                >
              </div>
            </div>

            <iframe
              v-else-if="info.mode === 'pdf' && info.inlineUrl"
              :src="info.inlineUrl"
              class="size-full max-h-full rounded-lg bg-white shadow-2xl"
              title="PDF-Vorschau"
            />

            <div
              v-else-if="info.mode === 'bild' && info.inlineUrl"
              class="flex max-h-full max-w-full items-center justify-center overflow-auto rounded-lg bg-surface p-2 shadow-2xl"
            >
              <img
                :src="info.inlineUrl"
                :alt="info.title"
                class="max-h-[85vh] max-w-full object-contain"
              >
            </div>

            <div
              v-else-if="info.mode === 'collabora' && info.collaboraUrl"
              class="flex size-full max-h-full flex-col gap-2"
            >
              <p
                v-if="info.hinweis"
                class="shrink-0 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-ink"
              >
                {{ info.hinweis }}
              </p>
              <iframe
                :src="info.collaboraUrl"
                class="min-h-0 w-full flex-1 rounded-lg bg-white shadow-2xl"
                :title="info.canWrite ? 'Office-Editor (Collabora)' : 'Office-Vorschau (Collabora)'"
                allow="fullscreen"
              />
            </div>

            <pre
              v-else-if="info.mode === 'text' && textInhalt !== null"
              class="max-h-full w-full max-w-4xl overflow-auto rounded-lg bg-surface p-4 text-sm text-ink shadow-2xl whitespace-pre-wrap"
            >{{ textInhalt }}</pre>

            <div
              v-else
              class="max-w-md rounded-xl bg-surface px-6 py-8 text-center shadow-lg"
            >
              <MaterialVorschauMiniatur
                v-if="info.thumbnailUrl"
                :asset-id="info.assetId"
                :file-name="info.fileName"
                :mime-type="info.mimeType"
                groesse="lg"
                class="mx-auto mb-4"
              />
              <UiIcon
                v-else
                :name="dateiIcon(info.fileName)"
                class="mb-3 text-3xl text-ink-subtle"
              />
              <p class="font-medium text-ink">
                {{ info.mode === 'download' ? 'Vorschau nicht verfügbar' : 'Keine Vorschau' }}
              </p>
              <p v-if="info.hinweis" class="mt-2 text-sm text-ink-muted">{{ info.hinweis }}</p>
              <p v-else-if="textFehler" class="mt-2 text-sm text-ink-muted">
                Der Text konnte nicht geladen werden.
              </p>
              <div class="mt-4 flex flex-wrap justify-center gap-2">
                <UiButton variante="primaer" icon="download" @click="herunterladen">
                  Herunterladen
                </UiButton>
                <a
                  v-if="info.mode === 'link' && info.url"
                  :href="info.url"
                  target="_blank"
                  rel="noopener"
                  class="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-hover"
                >
                  <UiIcon name="arrow-up-right-from-square" fest />
                  Link öffnen
                </a>
              </div>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
