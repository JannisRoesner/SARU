<script setup lang="ts">
import type { MaterialDetail } from '~~/server/repositories/material.repository'

definePageMeta({ middleware: [] })
useHead({ title: 'Moodle-Kurs anlegen' })

const { darfBearbeiten } = useSitzung()
const { aufruf, laeuft } = useApi()
const { fachOptionen, schlagwortNamen } = useTaxonomie()

if (!darfBearbeiten.value) {
  await navigateTo('/materialien')
}

const formular = reactive({
  title: '',
  description: '',
  schoolYear: '',
  subjectIds: [] as string[],
  tagNames: ['Moodle'] as string[],
})

const kursarchivDatei = ref<File | null>(null)
const meta = ref<Record<string, string | null> | null>(null)
const analyseFehler = ref<string | null>(null)
const analysiert = ref(false)
const ziehe = ref(false)
const dateiInput = ref<HTMLInputElement | null>(null)

const KURSARCHIV_ACCEPT = '.mbz,.imscc,application/gzip,application/x-gzip,application/zip'

async function kursarchivAuswaehlen(files: FileList | null | undefined) {
  analyseFehler.value = null
  meta.value = null
  analysiert.value = false
  const file = files?.[0]
  if (!file) return

  const lower = file.name.toLowerCase()
  if (!lower.endsWith('.mbz') && !lower.endsWith('.imscc')) {
    analyseFehler.value = 'Bitte eine Kursarchiv-Datei (.mbz oder .imscc) wählen.'
    return
  }

  kursarchivDatei.value = file
  const body = new FormData()
  body.append('file', file)

  try {
    const ergebnis = await $fetch<{
      meta: Record<string, string | null>
      vorschlaege: {
        title: string
        description: string
        variantLabel: string
        schoolYear: string
        tagNames: string[]
        source: string
      }
    }>('/api/materials/moodle/analyze', { method: 'POST', body })

    meta.value = ergebnis.meta
    formular.title = ergebnis.vorschlaege.title
    formular.description = ergebnis.vorschlaege.description
    formular.schoolYear = ergebnis.vorschlaege.schoolYear
    formular.tagNames = [...new Set([...formular.tagNames, ...ergebnis.vorschlaege.tagNames])]
    analysiert.value = true
  } catch (error) {
    kursarchivDatei.value = null
    analyseFehler.value = toApiFehler(error).nachricht
  }

  if (dateiInput.value) dateiInput.value.value = ''
}

async function anlegen() {
  if (!kursarchivDatei.value) {
    analyseFehler.value = 'Bitte zuerst eine .mbz- oder .imscc-Datei hochladen.'
    return
  }

  const ergebnis = await aufruf<MaterialDetail>('/api/materials', {
    method: 'POST',
    body: {
      title: formular.title.trim(),
      description: formular.description || null,
      materialType: 'moodle_kurs',
      source: meta.value?.moodleRelease
        ? `Moodle ${meta.value.moodleRelease}`
        : meta.value?.cartridgeVersion
          ? `IMS CC ${meta.value.cartridgeVersion}`
          : 'Moodle',
      subjectIds: formular.subjectIds,
      tagNames: formular.tagNames,
    },
  })
  if (!ergebnis) return

  const variante = ergebnis.variants.find((v) => v.isDefault) ?? ergebnis.variants[0]
  if (!variante) return

  await aufruf(`/api/variants/${variante.id}`, {
    method: 'PATCH',
    body: {
      label: formular.schoolYear.trim() || 'Aktuelle Fassung',
      variantKind: 'jahrgang',
      schoolYear: formular.schoolYear.trim() || null,
      notes: meta.value?.moodleRelease ? `Export für Moodle ${meta.value.moodleRelease}` : null,
    },
  })

  const body = new FormData()
  body.append('files', kursarchivDatei.value)
  body.append('role', 'haupt')
  await aufruf(`/api/variants/${variante.id}/uploads`, {
    method: 'POST',
    body,
    erfolgsmeldung: 'Moodle-Kurs gespeichert.',
  })

  await navigateTo(`/materialien/${ergebnis.id}`)
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <LayoutSeitenkopf
      zurueck-to="/materialien/neu"
      zurueck-label="Wege zum Anlegen"
      kicker="Materialien"
      titel="Moodle-Kurs anlegen"
      untertitel="Lade ein fertiges Kursarchiv (.mbz oder .imscc) hoch, verknüpfe es mit einer Reihe und stelle es später im SchulMoodle wieder her."
    />

    <form class="space-y-5" @submit.prevent="anlegen">
      <UiCard titel="Kursarchiv (.mbz / .imscc)" icon="graduation-cap">
        <div
          class="rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors"
          :class="ziehe ? 'border-primary bg-primary-soft/40' : 'border-line bg-surface-sunken/40'"
          @dragover.prevent="ziehe = true"
          @dragleave.prevent="ziehe = false"
          @drop.prevent="ziehe = false; kursarchivAuswaehlen(($event as DragEvent).dataTransfer?.files)"
        >
          <span
            class="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-[#f98012]/15 text-[#f98012]"
          >
            <UiIcon name="graduation-cap" class="text-2xl" fest />
          </span>
          <p class="font-medium text-ink">Kursarchiv hier ablegen</p>
          <p class="mt-1 text-sm text-ink-muted">
            Moodle: Kurs sichern → .mbz · OpenLearning/Canvas: Export → .imscc
          </p>
          <label class="mt-4 inline-flex cursor-pointer">
            <input
              ref="dateiInput"
              type="file"
              :accept="KURSARCHIV_ACCEPT"
              class="sr-only"
              @change="kursarchivAuswaehlen(($event.target as HTMLInputElement).files)"
            >
            <span class="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-hover">
              <UiIcon name="folder-open" fest /> Archiv wählen
            </span>
          </label>
        </div>

        <p v-if="analyseFehler" class="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {{ analyseFehler }}
        </p>

        <div
          v-if="kursarchivDatei && analysiert"
          class="mt-4 flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        >
          <UiIcon name="graduation-cap" class="shrink-0 text-[#f98012]" fest />
          <span class="min-w-0 flex-1 truncate font-medium">{{ kursarchivDatei.name }}</span>
          <span class="text-xs text-ink-subtle">{{ formatBytes(kursarchivDatei.size) }}</span>
        </div>

        <dl v-if="meta" class="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div v-if="meta.shortName">
            <dt class="text-ink-subtle">Kurzname</dt>
            <dd class="font-medium text-ink">{{ meta.shortName }}</dd>
          </div>
          <div v-if="meta.moodleRelease">
            <dt class="text-ink-subtle">Moodle</dt>
            <dd class="font-medium text-ink">{{ meta.moodleRelease }}</dd>
          </div>
          <div v-if="meta.cartridgeVersion">
            <dt class="text-ink-subtle">IMS CC</dt>
            <dd class="font-medium text-ink">{{ meta.cartridgeVersion }}</dd>
          </div>
          <div v-if="meta.backupDate">
            <dt class="text-ink-subtle">Backup-Datum</dt>
            <dd class="font-medium text-ink">{{ meta.backupDate }}</dd>
          </div>
          <div v-if="meta.courseFormat">
            <dt class="text-ink-subtle">Kursformat</dt>
            <dd class="font-medium text-ink">{{ meta.courseFormat }}</dd>
          </div>
        </dl>
      </UiCard>

      <UiCard titel="Material in SARU" icon="file-lines" einklappbar einklapp-id="moodle-meta">
        <div class="space-y-4">
          <UiField label="Titel" pflicht>
            <UiInput v-model="formular.title" placeholder="Kurstitel aus Moodle" />
          </UiField>
          <UiEinklappbaresFeld
            v-model="formular.description"
            label="Beschreibung"
            einklapp-id="moodle-beschreibung"
            leer-vorschau="Keine Beschreibung"
            placeholder="Wird aus dem Backup übernommen …"
            immer-offen
          />
          <UiField label="Kursversion / Schuljahr">
            <UiInput v-model="formular.schoolYear" placeholder="z. B. 2024/25" />
          </UiField>
          <UiField label="Fächer">
            <select
              multiple
              class="min-h-28 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              :value="formular.subjectIds"
              @change="formular.subjectIds = Array.from(($event.target as HTMLSelectElement).selectedOptions).map((o) => o.value)"
            >
              <option v-for="fach in fachOptionen" :key="fach.value" :value="fach.value">
                {{ fach.label }}
              </option>
            </select>
          </UiField>
          <UiField label="Schlagwörter">
            <UiTagInput v-model="formular.tagNames" :vorschlaege="schlagwortNamen" />
          </UiField>
        </div>
      </UiCard>

      <UiCard titel="Hinweis" icon="circle-info">
        <p class="text-sm leading-relaxed text-ink-muted">
          Dieses Material dient als Archiv-Paket für deinen SchulMoodle-Kurs. SARU speichert die
          .mbz- bzw. .imscc-Datei; Damit Schülerinnen und Schüler mit diesem Kurs erneut arbeiten
          können, muss er im SchulMoodle erneut importiert werden. Du kannst mehrere Versionen dieses
          MoodleKurses in diesem Material ablegen.
        </p>
      </UiCard>

      <div class="flex justify-end gap-2">
        <UiButton to="/materialien" variante="sekundaer">Abbrechen</UiButton>
        <UiButton
          type="submit"
          variante="primaer"
          icon="graduation-cap"
          :laedt="laeuft"
          :disabled="!formular.title.trim() || !kursarchivDatei"
        >
          Moodle-Kurs speichern
        </UiButton>
      </div>
    </form>
  </div>
</template>
