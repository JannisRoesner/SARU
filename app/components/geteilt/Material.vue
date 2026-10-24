<script setup lang="ts">
import { istInteraktivDatei } from '#shared/utils/interaktiv'
import { istVideoDatei } from '#shared/utils/abbildungen'
import { materialTypes, relationAnzeigeLabel } from '#shared/utils/labels'
import type { GastMaterial } from '~~/server/services/share-view.service'

/** Ansicht eines Materials über einen Freigabe-Link – mit Bearbeitung, wenn der Link es erlaubt. */
const props = defineProps<{
  token: string
  material: GastMaterial
  recht: 'ansehen' | 'bearbeiten'
}>()

const emit = defineEmits<{ geaendert: [] }>()

const { aufruf, laeuft } = useApi()
const { ziel } = useGastNavigation()
const basis = computed(() => `/api/geteilt/${props.token}/dateien`)
const darfBearbeiten = computed(() => props.recht === 'bearbeiten')

/** Erste interaktive Datei (SWF) – wird direkt auf der Seite abgespielt. */
const interaktiveDatei = computed(() => {
  for (const fassung of props.material.fassungen) {
    const datei = fassung.dateien.find((d) => d.kind === 'datei' && istInteraktivDatei(d.fileName))
    if (datei) return datei
  }
  return null
})

const istSammlung = computed(() => props.material.materialType === 'abbildungssammlung')

/** Erstes Video – wird direkt auf der Seite abgespielt. */
const videoDatei = computed(() => {
  for (const fassung of props.material.fassungen) {
    const datei = fassung.dateien.find((d) => d.kind === 'datei' && istVideoDatei(d.fileName))
    if (datei) return datei
  }
  return null
})

const vorschauId = ref<string | null>(null)
const vorschauOffen = computed({
  get: () => vorschauId.value !== null,
  set: (wert) => {
    if (!wert) vorschauId.value = null
  },
})

const formular = reactive({ title: '', description: '' })
watch(
  () => props.material,
  (m) => {
    formular.title = m.title
    formular.description = m.description ?? ''
  },
  { immediate: true },
)
const geaendert = computed(
  () => formular.title.trim() !== props.material.title || (formular.description || '') !== (props.material.description ?? ''),
)

async function speichern() {
  const ok = await aufruf(`/api/geteilt/${props.token}/materialien/${props.material.id}`, {
    method: 'PATCH',
    body: { title: formular.title.trim(), description: formular.description.trim() || null },
    erfolgsmeldung: 'Gespeichert.',
  })
  if (ok) emit('geaendert')
}

const dateiInput = ref<HTMLInputElement | null>(null)
async function hochladen(files: FileList | null) {
  if (!files?.length) return
  const body = new FormData()
  for (const f of Array.from(files)) body.append('files', f, f.name)
  const ok = await aufruf(`/api/geteilt/${props.token}/materialien/${props.material.id}/dateien`, {
    method: 'POST',
    body,
    erfolgsmeldung: 'Datei hinzugefügt.',
  })
  if (dateiInput.value) dateiInput.value.value = ''
  if (ok) emit('geaendert')
}

function zipHerunterladen() {
  window.open(`/api/geteilt/${props.token}/materialien/${props.material.id}/inhalt-zip`, '_blank')
}

function herunterladen(assetId: string) {
  window.open(`${basis.value}/${assetId}/download`, '_blank')
}

const istLehrwerk = computed(() => props.material.materialType === 'lehrwerk')

type Fassung = GastMaterial['fassungen'][number]
type Datei = Fassung['dateien'][number]

/** Anzeigename: eigener Titel, sonst trägt die einzige Hauptdatei den Materialtitel, sonst der Dateiname. */
function dateiTitel(datei: Datei, fassung: Fassung) {
  if (datei.title) return datei.title
  const haupt = fassung.dateien.filter((d) => d.role === 'haupt')
  if (datei.role === 'haupt' && haupt.length === 1) return props.material.title
  return datei.fileName || datei.url || 'Datei'
}

/** Zweite Zeile: Dateiname (falls nicht schon Titel) und Größe. */
function dateiInfo(datei: Datei, fassung: Fassung) {
  const name = datei.fileName || datei.url
  return [name !== dateiTitel(datei, fassung) && name, datei.sizeBytes && formatBytes(datei.sizeBytes)]
    .filter(Boolean)
    .join(' · ')
}
</script>

<template>
  <div class="space-y-5">
    <div>
      <p class="text-xs font-semibold tracking-wider text-ink-subtle uppercase">
        {{ materialTypes.label(material.materialType as never) }}
      </p>
      <template v-if="darfBearbeiten">
        <form class="mt-2 space-y-3" @submit.prevent="speichern">
          <UiField label="Titel">
            <UiInput v-model="formular.title" />
          </UiField>
          <UiField label="Beschreibung">
            <UiTextarea v-model="formular.description" :zeilen="3" />
          </UiField>
          <div class="flex justify-end">
            <UiButton type="submit" variante="primaer" icon="floppy-disk" :disabled="!geaendert" :laedt="laeuft">
              Speichern
            </UiButton>
          </div>
        </form>
      </template>
      <template v-else>
        <h1 class="mt-1 text-2xl font-semibold text-ink">{{ material.title }}</h1>
        <p v-if="material.description" class="mt-2 whitespace-pre-line text-ink-muted">{{ material.description }}</p>
      </template>
      <div v-if="material.subjects.length || material.gradeLevels.length" class="mt-3 flex flex-wrap gap-1.5">
        <UiBadge v-for="fach in material.subjects" :key="fach">{{ fach }}</UiBadge>
        <UiBadge v-if="material.gradeLevels.length">{{ formatJahrgaenge(material.gradeLevels as never) }}</UiBadge>
        <UiBadge v-if="material.source" icon="quote-left">{{ material.source }}</UiBadge>
      </div>
    </div>

    <UiCard
      v-if="material.inhalt.length"
      :titel="material.materialType === 'lernzirkel' ? 'Stationen' : 'Enthaltene Materialien'"
      :untertitel="`${material.inhalt.length} ${material.inhalt.length === 1 ? 'Material' : 'Materialien'}`"
      :icon="material.materialType === 'lernzirkel' ? 'map-location-dot' : 'layer-group'"
      einklappbar
      einklapp-id="geteilt-material-inhalt"
    >
      <template #kopf>
        <UiButton
          variante="sekundaer"
          groesse="sm"
          icon="file-zipper"
          title="Alle Dateien samt Lösungen als ZIP herunterladen"
          @click="zipHerunterladen"
        >
          Alle herunterladen (ZIP)
        </UiButton>
      </template>
      <ul class="space-y-2">
        <li v-for="m in material.inhalt" :key="m.id">
          <GeteiltKarte
            :token="token"
            :material="{
              id: m.id,
              title: m.title,
              materialType: m.materialType,
              vorschauDateiId: m.vorschauDateiId,
              vorschauDateiname: m.vorschauDateiname,
              vorschauMimeType: m.vorschauMimeType,
            }"
          />
        </li>
      </ul>
    </UiCard>

    <UiCard
      v-if="istSammlung"
      titel="Abbildungen"
      :untertitel="material.abbildungAnzahl ? `${material.abbildungAnzahl} Bilder` : undefined"
      icon="images"
    >
      <MaterialAbbildungsGalerie
        :liste-url="`/api/geteilt/${token}/materialien/${material.id}/abbildungen`"
        :datei-basis="basis"
        :abbildung-basis="`/api/geteilt/${token}/abbildungen`"
        :hochladen-url="darfBearbeiten ? `/api/geteilt/${token}/materialien/${material.id}/abbildungen` : null"
        :zip-url="`/api/geteilt/${token}/materialien/${material.id}/inhalt-zip`"
        @geaendert="emit('geaendert')"
      />
    </UiCard>

    <UiCard v-if="videoDatei" titel="Video" icon="film">
      <video
        :src="`${basis}/${videoDatei.id}/download?inline=1`"
        controls
        preload="metadata"
        class="max-h-[70vh] w-full rounded-lg bg-black"
      />
    </UiCard>

    <UiCard v-if="interaktiveDatei" titel="Interaktiver Inhalt" icon="hand-pointer">
      <MaterialInteraktivPlayer
        :src="`${basis}/${interaktiveDatei.id}/download?inline=1`"
        :titel="interaktiveDatei.title || interaktiveDatei.fileName"
      />
    </UiCard>

    <UiCard
      v-for="fassung in material.fassungen.filter((f) => !istSammlung && (f.dateien.length || darfBearbeiten))"
      :key="fassung.id"
      :titel="material.fassungen.length > 1 ? fassung.label : istLehrwerk ? 'Schulbuch' : 'Dateien'"
      :untertitel="istLehrwerk ? 'Buchdatei' : undefined"
      :icon="istLehrwerk ? 'book' : 'file-lines'"
      einklappbar
      :einklapp-id="`geteilt-material-dateien-${fassung.id}`"
    >
      <p v-if="!fassung.dateien.length" class="text-sm text-ink-subtle">Keine Dateien.</p>
      <ul v-else class="divide-y divide-line">
        <li v-for="datei in fassung.dateien" :key="datei.id" class="flex flex-wrap items-center gap-3 py-2.5">
          <MaterialVorschauMiniatur
            v-if="datei.kind === 'datei'"
            :asset-id="datei.id"
            :file-name="datei.fileName"
            :mime-type="datei.mimeType"
            :material-type="material.materialType"
            :api-basis="basis"
            groesse="sm"
          />
          <span class="min-w-0 flex-1">
            <span class="line-clamp-2 font-medium break-words text-ink">{{ dateiTitel(datei, fassung) }}</span>
            <span
              v-if="dateiInfo(datei, fassung)"
              class="block truncate text-xs text-ink-subtle"
              :title="datei.fileName || datei.url || undefined"
            >
              {{ dateiInfo(datei, fassung) }}
            </span>
          </span>
          <template v-if="datei.kind === 'datei'">
            <div class="flex shrink-0 gap-1.5">
              <UiButton variante="sekundaer" groesse="sm" icon="eye" title="Ansehen" @click="vorschauId = datei.id">
                <span class="hidden sm:inline">Ansehen</span>
              </UiButton>
              <UiButton variante="sekundaer" groesse="sm" icon="download" title="Herunterladen" @click="herunterladen(datei.id)">
                <span class="hidden sm:inline">Herunterladen</span>
              </UiButton>
            </div>
          </template>
          <UiButton
            v-else-if="datei.url"
            :to="datei.url"
            variante="sekundaer"
            groesse="sm"
            icon="arrow-up-right-from-square"
            title="Öffnen"
          >
            <span class="hidden sm:inline">Öffnen</span>
          </UiButton>
        </li>
      </ul>
    </UiCard>

    <div v-if="darfBearbeiten && !istSammlung">
      <input ref="dateiInput" type="file" multiple class="sr-only" @change="hochladen(($event.target as HTMLInputElement).files)">
      <UiButton variante="sekundaer" icon="cloud-arrow-up" :laedt="laeuft" @click="dateiInput?.click()">
        Datei hinzufügen
      </UiButton>
    </div>

    <UiCard v-if="material.anhaengend.length" titel="Verknüpftes Material" icon="link" einklappbar einklapp-id="geteilt-material-verknuepft">
      <ul class="space-y-1">
        <li v-for="teil in material.anhaengend" :key="teil.id">
          <span class="mr-2 text-xs text-ink-subtle">{{ relationAnzeigeLabel(teil.relationType, 'ausgehend') }}</span>
          <NuxtLink :to="ziel(`/geteilt/${token}/material/${teil.id}`)" class="font-medium text-primary hover:underline">
            {{ teil.title }}
          </NuxtLink>
          <span class="ml-2 text-xs text-ink-subtle">{{ materialTypes.label(teil.materialType as never) }}</span>
        </li>
      </ul>
    </UiCard>

    <MaterialVorschauModal
      v-model="vorschauOffen"
      :asset-id="vorschauId"
      :api-basis="basis"
    />
  </div>
</template>
