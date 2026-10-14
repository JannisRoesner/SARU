<script setup lang="ts">
import { gruppiereLehrwerkInhalt } from '#shared/utils/lehrwerk'
import type { GastMaterial, GastMaterialKurz, GastReihe } from '~~/server/services/share-view.service'

definePageMeta({ layout: 'geteilt' })
useHead({ title: 'Geteilter Zugang', meta: [{ name: 'robots', content: 'noindex, nofollow' }] })

interface Startansicht {
  recht: 'ansehen' | 'bearbeiten'
  label: string | null
  erstelltVon: string
  laeuftAb: string | null
  wurzel: { typ: 'material' | 'reihe'; id: string; materialType?: string }
  material?: GastMaterial
  inhalt?: GastMaterialKurz[] | null
  reihe?: GastReihe
}

const { token } = await useFreigabe()
const { ziel } = useGastNavigation()
const suchtGerade = computed(() => Boolean(suche.value.trim()))
const { offen: gruppeOffen, umschalten: gruppeUmschalten, alleZugeklappt, alleUmschalten } = useGruppenEinklappen(
  () => `saru.geteilt.zugeklappt.${token.value}`,
  () => gruppen.value.map((g) => g.id),
  suchtGerade,
)
const { data, error, refresh } = await useFetch<Startansicht>(() => `/api/geteilt/${token.value}`)

const suche = ref('')
const gruppen = computed(() => {
  const begriff = suche.value.trim().toLowerCase()
  const items = (data.value?.inhalt ?? []).filter(
    (m) => !begriff || m.title.toLowerCase().includes(begriff) || (m.description ?? '').toLowerCase().includes(begriff),
  )
  return gruppiereLehrwerkInhalt(items)
})

function lehrwerkZip(id: string) {
  window.open(`/api/geteilt/${token.value}/materialien/${id}/inhalt-zip`, '_blank')
}

const { aufruf, laeuft } = useApi()
const uploadInput = ref<HTMLInputElement | null>(null)
async function inLehrwerkHochladen(files: FileList | null) {
  if (!files?.length) return
  const body = new FormData()
  for (const f of Array.from(files)) body.append('files', f, f.name)
  const ok = await aufruf(`/api/geteilt/${token.value}/materialien`, {
    method: 'POST',
    body,
    erfolgsmeldung: files.length === 1 ? 'Material hinzugefügt.' : `${files.length} Materialien hinzugefügt.`,
  })
  if (uploadInput.value) uploadInput.value.value = ''
  if (ok) await refresh()
}
</script>

<template>
  <div>
    <div v-if="error" class="mx-auto max-w-md rounded-xl border border-line bg-surface px-6 py-10 text-center">
      <UiIcon name="link-slash" class="mb-3 text-3xl text-ink-subtle" />
      <p class="font-medium text-ink">Dieser Link funktioniert nicht.</p>
      <p class="mt-2 text-sm text-ink-muted">{{ toApiFehler(error).nachricht }}</p>
    </div>

    <template v-else-if="data">
      <ClientOnly>
        <p v-if="data.laeuftAb" class="mb-4 text-xs text-ink-subtle">
          Gültig bis {{ formatDatumZeit(data.laeuftAb) }}
        </p>
      </ClientOnly>

      <!-- Material oder Lehrwerk -->
      <template v-if="data.material">
        <GeteiltMaterial :token="token" :material="data.material" :recht="data.recht" @geaendert="refresh()" />

        <section v-if="data.inhalt" class="mt-8 space-y-4">
          <div class="flex flex-col gap-3 border-b border-line pb-4 md:flex-row md:items-center">
            <div class="flex-1">
              <h2 class="flex items-center gap-2 text-lg font-semibold text-ink">
                <UiIcon name="layer-group" class="text-primary" fest /> Inhalt des Lehrwerks
              </h2>
              <p class="text-sm text-ink-muted">
                {{ data.inhalt.length }} {{ data.inhalt.length === 1 ? 'Material' : 'Materialien' }}
                zum Schulbuch
              </p>
            </div>
            <UiButton
              variante="sekundaer"
              icon="file-zipper"
              title="Schulbuch, Serviceband, Versuche, Arbeitsblätter, Lernzirkel … in Ordnern als ZIP"
              class="self-start md:self-auto"
              @click="lehrwerkZip(data.material.id)"
            >
              Komplettes Lehrwerk herunterladen (ZIP)
            </UiButton>
            <div class="flex items-center gap-2">
              <UiInput
                v-model="suche"
                icon="magnifying-glass"
                placeholder="Inhalt durchsuchen …"
                aria-label="Inhalt des Lehrwerks durchsuchen"
                class="min-w-0 flex-1 md:w-72"
              />
              <UiButton
                v-if="gruppen.length > 1 && !suchtGerade"
                variante="sekundaer"
                :icon="alleZugeklappt ? 'angles-down' : 'angles-up'"
                nur-icon
                :title="alleZugeklappt ? 'Alle ausklappen' : 'Alle einklappen'"
                :aria-label="alleZugeklappt ? 'Alle ausklappen' : 'Alle einklappen'"
                @click="alleUmschalten"
              />
              <template v-if="data.recht === 'bearbeiten'">
                <input ref="uploadInput" type="file" multiple class="sr-only" @change="inLehrwerkHochladen(($event.target as HTMLInputElement).files)">
                <UiButton variante="primaer" icon="cloud-arrow-up" :laedt="laeuft" title="Material hochladen" @click="uploadInput?.click()">
                  <span class="hidden sm:inline">Hochladen</span>
                </UiButton>
              </template>
            </div>
          </div>

          <p v-if="!gruppen.length" class="text-sm text-ink-subtle">Keine Treffer.</p>

          <section v-for="gruppe in gruppen" :key="gruppe.id" class="space-y-2">
            <h3 class="text-sm font-semibold text-ink">
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                :aria-expanded="gruppeOffen(gruppe.id)"
                :aria-controls="`gruppe-${gruppe.id}`"
                @click="gruppeUmschalten(gruppe.id)"
              >
                <UiIcon
                  name="chevron-down"
                  fest
                  class="text-xs text-ink-subtle transition-transform duration-200"
                  :class="!gruppeOffen(gruppe.id) && '-rotate-90'"
                />
                <UiIcon :name="gruppe.icon" class="text-primary" fest /> {{ gruppe.label }}
                <span class="font-normal text-ink-subtle">{{ gruppe.eintraege.length }}</span>
              </button>
            </h3>
            <ul v-show="gruppeOffen(gruppe.id)" :id="`gruppe-${gruppe.id}`" class="space-y-2">
              <li v-for="m in gruppe.eintraege" :key="m.id">
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
          </section>
        </section>
      </template>

      <!-- Reihe -->
      <template v-else-if="data.reihe">
        <p class="text-xs font-semibold tracking-wider text-ink-subtle uppercase">Unterrichtsreihe</p>
        <h1 class="mt-1 text-2xl font-semibold text-ink">{{ data.reihe.title }}</h1>
        <p class="mt-1 text-sm text-ink-muted">
          {{ [data.reihe.subject, data.reihe.schoolYear].filter(Boolean).join(' · ') }}
        </p>
        <p v-if="data.reihe.description" class="mt-3 whitespace-pre-line text-ink-muted">{{ data.reihe.description }}</p>

        <UiCard titel="Stunden" icon="chalkboard-user" class="mt-6" einklappbar einklapp-id="geteilt-reihe-stunden">
          <p v-if="!data.reihe.stunden.length" class="text-sm text-ink-subtle">Keine Stunden.</p>
          <ol v-else class="space-y-2">
            <li v-for="(stunde, index) in data.reihe.stunden" :key="stunde.id">
              <NuxtLink :to="ziel(`/geteilt/${token}/stunde/${stunde.id}`)" class="karte karte-klickbar flex items-center gap-3 p-3">
                <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-sm font-semibold text-primary-strong">
                  {{ index + 1 }}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium text-ink">{{ stunde.title }}</span>
                  <span class="text-xs text-ink-subtle">
                    {{ stunde.date ? formatDatum(stunde.date) : 'ohne Datum' }} · {{ stunde.materialCount }} Material
                  </span>
                </span>
              </NuxtLink>
            </li>
          </ol>
        </UiCard>

        <UiCard v-if="data.reihe.materialien.length" titel="Material der Reihe" icon="folder-open" class="mt-4" einklappbar einklapp-id="geteilt-reihe-material">
          <ul class="space-y-2">
            <li v-for="m in data.reihe.materialien" :key="m.materialId">
              <GeteiltKarte :token="token" :material="{ ...m, id: m.materialId }" />
            </li>
          </ul>
        </UiCard>
      </template>
    </template>
  </div>
</template>
