<script setup lang="ts">
interface Freigabe {
  id: string
  permission: 'ansehen' | 'bearbeiten'
  label: string | null
  pfad: string
  createdAt: string
  createdByName: string | null
  expiresAt: string | null
  lastUsedAt: string | null
  useCount: number
}

const offen = defineModel<boolean>({ required: true })

const props = defineProps<{
  entityType: 'material' | 'reihe'
  entityId: string
  /** Name des geteilten Objekts für die Überschrift. */
  titel: string
}>()

const { aufruf, laeuft } = useApi()
const hinweise = useHinweise()

const links = ref<Freigabe[]>([])
const laedt = ref(false)
const neu = reactive({ permission: 'ansehen' as 'ansehen' | 'bearbeiten', ablauf: '30', label: '' })
const zurueckziehenId = ref<string | null>(null)

const rechtOptionen = computed(() => [
  { value: 'ansehen', label: 'Ansehen und herunterladen' },
  ...(props.entityType === 'material'
    ? [{ value: 'bearbeiten', label: 'Bearbeiten (inkl. Hochladen und Word-Bearbeitung)' }]
    : []),
])
const ablaufOptionen = [
  { value: '7', label: '7 Tage' },
  { value: '30', label: '30 Tage' },
  { value: '365', label: '1 Jahr' },
  { value: 'nie', label: 'Unbegrenzt' },
]

async function laden() {
  laedt.value = true
  try {
    links.value = await $fetch<Freigabe[]>('/api/freigaben', {
      query: { entityType: props.entityType, entityId: props.entityId },
    })
  } catch (error) {
    hinweise.fehler(toApiFehler(error).nachricht)
  } finally {
    laedt.value = false
  }
}

watch(offen, (istOffen) => {
  if (istOffen) {
    zurueckziehenId.value = null
    void laden()
  }
}, { immediate: true })

function vollerLink(pfad: string) {
  return import.meta.client ? `${window.location.origin}${pfad}` : pfad
}

async function kopieren(pfad: string) {
  const text = vollerLink(pfad)
  try {
    await navigator.clipboard.writeText(text)
    hinweise.erfolg('Link kopiert.')
  } catch {
    window.prompt('Link kopieren:', text)
  }
}

async function erstellen() {
  const eintrag = await aufruf<Freigabe>('/api/freigaben', {
    method: 'POST',
    body: {
      entityType: props.entityType,
      entityId: props.entityId,
      permission: neu.permission,
      label: neu.label.trim() || null,
      ablaufTage: neu.ablauf === 'nie' ? null : Number(neu.ablauf),
    },
  })
  if (!eintrag) return
  links.value = [eintrag, ...links.value]
  neu.label = ''
  await kopieren(eintrag.pfad)
}

async function zurueckziehen(id: string) {
  if (zurueckziehenId.value !== id) {
    zurueckziehenId.value = id
    return
  }
  const ok = await aufruf(`/api/freigaben/${id}`, { method: 'DELETE', erfolgsmeldung: 'Link zurückgezogen.' })
  zurueckziehenId.value = null
  if (ok !== null) links.value = links.value.filter((l) => l.id !== id)
}

function meta(link: Freigabe) {
  const teile = [`erstellt ${formatDatumZeit(link.createdAt)}`]
  if (link.createdByName) teile.push(`von ${link.createdByName}`)
  teile.push(link.expiresAt ? `gültig bis ${formatDatumZeit(link.expiresAt)}` : 'unbegrenzt gültig')
  teile.push(`${link.useCount} ${link.useCount === 1 ? 'Aufruf' : 'Aufrufe'}`)
  return teile.join(' · ')
}
</script>

<template>
  <UiModal
    v-model="offen"
    titel="Per Link teilen"
    :beschreibung="titel"
    icon="share-nodes"
    breite="lg"
  >
    <p class="mb-4 text-sm text-ink-muted">
      Wer den Link hat, kann ohne Konto zugreifen – solange er gültig ist und nicht zurückgezogen wurde.
      KI-Funktionen, Suche und das übrige Archiv sind über Links nicht erreichbar.
    </p>

    <form class="grid gap-3 rounded-xl border border-line bg-surface-sunken/40 p-4 sm:grid-cols-2" @submit.prevent="erstellen">
      <UiField label="Rechte">
        <UiSelect v-model="neu.permission" :optionen="rechtOptionen" />
      </UiField>
      <UiField label="Gültigkeit">
        <UiSelect v-model="neu.ablauf" :optionen="ablaufOptionen" />
      </UiField>
      <UiField label="Bezeichnung (optional)" class="sm:col-span-2">
        <UiInput v-model="neu.label" placeholder="z. B. Fachschaft Biologie" />
      </UiField>
      <div class="flex justify-end sm:col-span-2">
        <UiButton type="submit" variante="primaer" icon="link" :laedt="laeuft">Link erstellen und kopieren</UiButton>
      </div>
    </form>

    <section class="mt-5">
      <h3 class="mb-2 text-sm font-semibold text-ink">Aktive Links</h3>
      <UiSkelett v-if="laedt" art="liste" :zeilen="2" />
      <p v-else-if="!links.length" class="text-sm text-ink-subtle">Noch keine aktiven Links.</p>
      <ul v-else class="space-y-2">
        <li
          v-for="link in links"
          :key="link.id"
          class="flex flex-col gap-2 rounded-xl border border-line p-3 sm:flex-row sm:items-center"
        >
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <UiBadge :icon="link.permission === 'bearbeiten' ? 'pen-to-square' : 'eye'">
                {{ link.permission === 'bearbeiten' ? 'Bearbeiten' : 'Ansehen' }}
              </UiBadge>
              <span class="truncate font-medium text-ink">{{ link.label || 'Ohne Bezeichnung' }}</span>
            </div>
            <p class="mt-1 text-xs text-ink-subtle">{{ meta(link) }}</p>
          </div>
          <div class="flex shrink-0 gap-2">
            <UiButton
              v-if="link.pfad"
              variante="sekundaer"
              groesse="sm"
              icon="copy"
              @click="kopieren(link.pfad)"
            >
              Kopieren
            </UiButton>
            <UiButton
              :variante="zurueckziehenId === link.id ? 'gefahr' : 'sekundaer'"
              groesse="sm"
              icon="link-slash"
              @click="zurueckziehen(link.id)"
            >
              {{ zurueckziehenId === link.id ? 'Wirklich zurückziehen?' : 'Zurückziehen' }}
            </UiButton>
          </div>
        </li>
      </ul>
    </section>
  </UiModal>
</template>
