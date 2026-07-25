<script setup lang="ts">
import { searchEntityTypes } from '#shared/utils/labels'

const offen = defineModel<boolean>({ required: true })

interface Treffer {
  entityType: 'material' | 'unterrichtsstunde' | 'reihe'
  entityId: string
  title: string
  snippet: string | null
  sourceLabel: string | null
  matchedIn: string[]
  datensatz: Record<string, unknown>
}

interface Vorschlag {
  value: string
  kind: string
  entityId?: string
}

const eingabe = ref('')
const treffer = ref<Treffer[]>([])
const vorschlaege = ref<Vorschlag[]>([])
const laedt = ref(false)
const markiert = ref(0)
const feld = ref<HTMLInputElement | null>(null)

const PFADE = {
  material: '/materialien',
  unterrichtsstunde: '/stunden',
  reihe: '/reihen',
} as const

const VORSCHLAG_ICONS: Record<string, string> = {
  verlauf: 'clock-rotate-left',
  schlagwort: 'tag',
  thema: 'sitemap',
  fach: 'palette',
  material: 'file-lines',
  unterrichtsstunde: 'chalkboard-user',
  reihe: 'layer-group',
}

let abbruch: AbortController | undefined

async function suchen() {
  const query = eingabe.value.trim()
  abbruch?.abort()

  if (query.length < 2) {
    treffer.value = []
    vorschlaege.value = []
    laedt.value = false
    return
  }

  abbruch = new AbortController()
  laedt.value = true
  try {
    const [ergebnis, hinweise] = await Promise.all([
      $fetch<{ treffer: Treffer[] }>('/api/search', {
        query: { q: query, limit: 8 },
        signal: abbruch.signal,
      }),
      $fetch<{ vorschlaege: Vorschlag[] }>('/api/search/suggest', {
        query: { q: query, limit: 5 },
        signal: abbruch.signal,
      }),
    ])
    treffer.value = ergebnis.treffer
    // Vorschläge, die schon als Treffer erscheinen, wären doppelt.
    vorschlaege.value = hinweise.vorschlaege.filter(
      (v) => !ergebnis.treffer.some((t) => t.title === v.value),
    )
    markiert.value = 0
  } catch (error) {
    if ((error as Error)?.name !== 'AbortError') {
      treffer.value = []
      vorschlaege.value = []
    }
  } finally {
    if (!abbruch?.signal.aborted) laedt.value = false
  }
}

let entprellung: ReturnType<typeof setTimeout> | undefined
watch(eingabe, () => {
  if (entprellung) clearTimeout(entprellung)
  entprellung = setTimeout(suchen, 180)
})

const eintraege = computed(() => [
  ...treffer.value.map((t) => ({ art: 'treffer' as const, treffer: t })),
  ...vorschlaege.value.map((v) => ({ art: 'vorschlag' as const, vorschlag: v })),
])

function oeffnen(index: number) {
  const eintrag = eintraege.value[index]
  if (!eintrag) return

  if (eintrag.art === 'treffer') {
    const t = eintrag.treffer
    offen.value = false
    return navigateTo(`${PFADE[t.entityType]}/${t.entityId}`)
  }

  // Ein Vorschlag verfeinert nur die Anfrage bzw. führt zur Ergebnisseite.
  eingabe.value = eintrag.vorschlag.value
  void alleErgebnisse()
}

async function alleErgebnisse() {
  const query = eingabe.value.trim()
  if (!query) return
  offen.value = false
  await navigateTo({ path: '/suche', query: { q: query } })
}

function beiTaste(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    markiert.value = (markiert.value + 1) % Math.max(eintraege.value.length, 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    markiert.value = (markiert.value - 1 + eintraege.value.length) % Math.max(eintraege.value.length, 1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    if (eintraege.value.length) oeffnen(markiert.value)
    else void alleErgebnisse()
  }
}

watch(offen, async (istOffen) => {
  if (!istOffen) return
  eingabe.value = ''
  treffer.value = []
  vorschlaege.value = []
  await nextTick()
  feld.value?.focus()
})
</script>

<template>
  <UiModal v-model="offen" titel="Suche" icon="magnifying-glass" breite="lg">
    <div class="-mx-6 -mt-5">
      <div class="flex items-center gap-3 border-b border-line px-6 py-3">
        <UiIcon v-if="laedt" name="circle-notch" dreht class="text-ink-subtle" />
        <UiIcon v-else name="magnifying-glass" class="text-ink-subtle" />
        <input
          ref="feld"
          v-model="eingabe"
          type="search"
          placeholder="Titel, Inhalt, Schlagwort oder Fach …"
          class="flex-1 bg-transparent text-base text-ink placeholder:text-ink-subtle focus:outline-none"
          aria-label="Suchbegriff"
          @keydown="beiTaste"
        >
      </div>

      <div class="max-h-[55vh] overflow-y-auto">
        <p v-if="eingabe.trim().length < 2" class="px-6 py-10 text-center text-sm text-ink-subtle">
          Mindestens zwei Zeichen eingeben. Gesucht wird in Titeln, Beschreibungen, Schlagwörtern
          und im Text hochgeladener Dokumente.
        </p>

        <UiLeerzustand
          v-else-if="!laedt && !eintraege.length"
          klein
          icon="magnifying-glass-minus"
          titel="Keine Treffer"
          :text="`Für „${eingabe}“ wurde nichts gefunden.`"
        />

        <ul v-else class="py-2">
          <li v-for="(eintrag, index) in eintraege" :key="index">
            <button
              type="button"
              class="flex w-full items-start gap-3 px-6 py-2.5 text-left transition-colors"
              :class="index === markiert ? 'bg-primary-soft' : 'hover:bg-surface-hover'"
              @click="oeffnen(index)"
              @mouseenter="markiert = index"
            >
              <template v-if="eintrag.art === 'treffer'">
                <UiIcon
                  :name="searchEntityTypes.icon(eintrag.treffer.entityType) ?? 'file'"
                  class="mt-1 shrink-0 text-primary"
                  fest
                />
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-2">
                    <span class="truncate font-medium text-ink">{{ eintrag.treffer.title }}</span>
                    <UiBadge groesse="sm">
                      {{ searchEntityTypes.label(eintrag.treffer.entityType) }}
                    </UiBadge>
                  </span>
                  <!-- eslint-disable-next-line vue/no-v-html -- Nur <mark> aus ts_headline, serverseitig erzeugt. -->
                  <span
                    v-if="eintrag.treffer.snippet"
                    class="treffer mt-0.5 line-clamp-2 block text-xs leading-relaxed text-ink-muted"
                    v-html="eintrag.treffer.snippet"
                  />
                  <span
                    v-if="eintrag.treffer.matchedIn.includes('inhalt') && eintrag.treffer.sourceLabel"
                    class="mt-1 flex items-center gap-1 text-[0.7rem] text-ink-subtle"
                  >
                    <UiIcon name="file-magnifying-glass" />
                    Fundstelle in {{ eintrag.treffer.sourceLabel }}
                  </span>
                </span>
              </template>

              <template v-else>
                <UiIcon
                  :name="VORSCHLAG_ICONS[eintrag.vorschlag.kind] ?? 'magnifying-glass'"
                  class="mt-0.5 shrink-0 text-ink-subtle"
                  fest
                />
                <span class="min-w-0 flex-1 truncate text-sm text-ink-muted">
                  {{ eintrag.vorschlag.value }}
                </span>
              </template>
            </button>
          </li>
        </ul>
      </div>
    </div>

    <template #aktionen>
      <span class="mr-auto hidden items-center gap-3 text-xs text-ink-subtle sm:flex">
        <span><kbd class="rounded border border-line px-1">↑</kbd> <kbd class="rounded border border-line px-1">↓</kbd> Auswählen</span>
        <span><kbd class="rounded border border-line px-1">Enter</kbd> Öffnen</span>
        <span><kbd class="rounded border border-line px-1">Esc</kbd> Schließen</span>
      </span>
      <UiButton
        variante="primaer"
        icon="list"
        :disabled="eingabe.trim().length < 2"
        @click="alleErgebnisse"
      >
        Alle Ergebnisse
      </UiButton>
    </template>
  </UiModal>
</template>
