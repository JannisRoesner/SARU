<script setup lang="ts">
import { gruppiereLehrwerkInhalt } from '#shared/utils/lehrwerk'
import { materialTypes } from '#shared/utils/labels'
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
const { data, error, refresh } = await useFetch<Startansicht>(() => `/api/geteilt/${token.value}`)

const suche = ref('')
const gruppen = computed(() => {
  const begriff = suche.value.trim().toLowerCase()
  const items = (data.value?.inhalt ?? []).filter(
    (m) => !begriff || m.title.toLowerCase().includes(begriff) || (m.description ?? '').toLowerCase().includes(begriff),
  )
  return gruppiereLehrwerkInhalt(items)
})

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
          <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div class="flex-1">
              <h2 class="text-lg font-semibold text-ink">Inhalt des Lehrwerks</h2>
              <p class="text-sm text-ink-muted">
                {{ data.inhalt.length }} {{ data.inhalt.length === 1 ? 'Material' : 'Materialien' }}
              </p>
            </div>
            <UiInput v-model="suche" icon="magnifying-glass" placeholder="Lehrwerk durchsuchen …" class="sm:w-72" />
            <template v-if="data.recht === 'bearbeiten'">
              <input ref="uploadInput" type="file" multiple class="sr-only" @change="inLehrwerkHochladen(($event.target as HTMLInputElement).files)">
              <UiButton variante="primaer" icon="cloud-arrow-up" :laedt="laeuft" @click="uploadInput?.click()">
                Material hochladen
              </UiButton>
            </template>
          </div>

          <p v-if="!gruppen.length" class="text-sm text-ink-subtle">Keine Treffer.</p>
          <section v-for="gruppe in gruppen" :key="gruppe.id" class="space-y-2">
            <h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
              <UiIcon :name="gruppe.icon" class="text-primary" fest /> {{ gruppe.label }}
              <span class="text-ink-subtle">{{ gruppe.eintraege.length }}</span>
            </h3>
            <ul class="grid gap-2 sm:grid-cols-2">
              <li v-for="m in gruppe.eintraege" :key="m.id">
                <NuxtLink
                  :to="`/geteilt/${token}/material/${m.id}`"
                  class="karte karte-klickbar flex items-center gap-3 p-3"
                >
                  <MaterialVorschauMiniatur
                    :asset-id="m.vorschauDateiId"
                    :file-name="m.vorschauDateiname"
                    :mime-type="m.vorschauMimeType"
                    :material-type="m.materialType"
                    :api-basis="`/api/geteilt/${token}/dateien`"
                    groesse="sm"
                  />
                  <span class="min-w-0">
                    <span class="block truncate font-medium text-ink">{{ m.title }}</span>
                    <span class="text-xs text-ink-subtle">{{ materialTypes.label(m.materialType as never) }}</span>
                  </span>
                </NuxtLink>
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

        <UiCard titel="Stunden" icon="chalkboard-user" class="mt-6">
          <p v-if="!data.reihe.stunden.length" class="text-sm text-ink-subtle">Keine Stunden.</p>
          <ol v-else class="space-y-2">
            <li v-for="(stunde, index) in data.reihe.stunden" :key="stunde.id">
              <NuxtLink :to="`/geteilt/${token}/stunde/${stunde.id}`" class="karte karte-klickbar flex items-center gap-3 p-3">
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

        <UiCard v-if="data.reihe.materialien.length" titel="Material der Reihe" icon="folder-open" class="mt-4">
          <ul class="space-y-1">
            <li v-for="m in data.reihe.materialien" :key="m.materialId">
              <NuxtLink :to="`/geteilt/${token}/material/${m.materialId}`" class="font-medium text-primary hover:underline">
                {{ m.title }}
              </NuxtLink>
              <span class="ml-2 text-xs text-ink-subtle">{{ materialTypes.label(m.materialType as never) }}</span>
            </li>
          </ul>
        </UiCard>
      </template>
    </template>
  </div>
</template>
