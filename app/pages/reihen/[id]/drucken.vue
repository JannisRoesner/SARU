<script setup lang="ts">
import { seriesStatuses, lessonStatuses, socialForms } from '#shared/utils/labels'
import type { SeriesDetail } from '~~/server/repositories/series.repository'
import type { LessonDetail } from '~~/server/repositories/lesson.repository'

definePageMeta({ layout: 'druck' })

const route = useRoute()
const id = computed(() => String(route.params.id))

const { data: reihe, error, refresh } = await useFetch<SeriesDetail>(
  () => `/api/series/${id.value}`,
)

useHead({ title: () => (reihe.value ? `Druck · ${reihe.value.title}` : 'Druck') })

const stundenDetails = ref<LessonDetail[]>([])
const laedtDetails = ref(false)

watch(
  reihe,
  async (wert) => {
    if (!wert?.lessons.length) {
      stundenDetails.value = []
      return
    }
    laedtDetails.value = true
    try {
      stundenDetails.value = await Promise.all(
        wert.lessons.map((l) => $fetch<LessonDetail>(`/api/lessons/${l.id}`)),
      )
    } finally {
      laedtDetails.value = false
    }
  },
  { immediate: true },
)

function drucken() {
  if (import.meta.client) window.print()
}
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-8 lg:px-8">
    <div class="kein-druck mb-6 flex flex-wrap items-center justify-between gap-3">
      <NuxtLink
        :to="`/reihen/${id}`"
        class="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary"
      >
        <UiIcon name="arrow-left" fest /> Zurück zur Reihe
      </NuxtLink>
      <UiButton variante="primaer" icon="print" @click="drucken">Drucken</UiButton>
    </div>

    <UiFehlerzustand v-if="error" :text="toApiFehler(error).nachricht" @erneut="refresh()" />

    <template v-else-if="reihe">
      <header class="mb-8 border-b border-line pb-6">
        <p class="text-xs font-semibold tracking-[0.14em] text-ink-subtle uppercase">
          Verlaufsplan · Unterrichtsreihe
        </p>
        <h1 class="mt-2 text-3xl tracking-tight text-ink">{{ reihe.title }}</h1>
        <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
          <span v-if="reihe.subject">{{ reihe.subject.name }}</span>
          <span v-if="reihe.learningGroup">{{ reihe.learningGroup.name }}</span>
          <span v-if="reihe.schoolYear">Schuljahr {{ reihe.schoolYear }}</span>
          <span>{{ seriesStatuses.label(reihe.status) }}</span>
          <span>{{ formatZeitraum(reihe.startDate, reihe.endDate) }}</span>
        </div>
        <p v-if="reihe.description" class="mt-4 text-sm leading-relaxed text-ink-muted">
          {{ reihe.description }}
        </p>
      </header>

      <p v-if="laedtDetails" class="text-sm text-ink-muted">Lade Stundendetails …</p>

      <section
        v-for="(stunde, index) in stundenDetails"
        :key="stunde.id"
        class="druck-seitenumbruch mb-10"
      >
        <div class="mb-3 flex items-baseline gap-3 border-b border-line pb-2">
          <span class="text-sm font-semibold text-primary">Stunde {{ index + 1 }}</span>
          <h2 class="text-xl text-ink">{{ stunde.title }}</h2>
        </div>
        <div class="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
          <span v-if="stunde.date">{{ formatDatumLang(stunde.date) }}</span>
          <span v-if="formatSchulstunden(stunde.periodFrom, stunde.periodTo)">
            {{ formatSchulstunden(stunde.periodFrom, stunde.periodTo) }}
          </span>
          <span>{{ lessonStatuses.label(stunde.status) }}</span>
        </div>

        <p v-if="stunde.methodSummary" class="mb-3 text-sm">
          <strong>Methoden:</strong> {{ stunde.methodSummary }}
        </p>
        <p v-if="stunde.learningObjectives?.length" class="mb-3 text-sm">
          <strong>Lernziele:</strong> {{ stunde.learningObjectives.join(' · ') }}
        </p>

        <table v-if="stunde.phases.length" class="mb-4 w-full border-collapse text-sm">
          <thead>
            <tr class="border-b border-line text-left text-xs tracking-wide text-ink-subtle uppercase">
              <th class="py-2 pr-2 w-12">Nr.</th>
              <th class="py-2 pr-2">Phase</th>
              <th class="py-2 pr-2 w-16">Min.</th>
              <th class="py-2 pr-2">Inhalt / Aktivitäten</th>
              <th class="py-2">Sozialform</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(phase, pIndex) in stunde.phases"
              :key="phase.id"
              class="border-b border-line align-top"
            >
              <td class="py-2 pr-2 text-ink-subtle">{{ pIndex + 1 }}</td>
              <td class="py-2 pr-2 font-medium">{{ phase.name }}</td>
              <td class="py-2 pr-2">{{ phase.durationMinutes ?? '–' }}</td>
              <td class="py-2 pr-2">
                <p v-if="phase.content">{{ phase.content }}</p>
                <p v-if="phase.teacherActivity" class="mt-1 text-ink-muted">
                  L: {{ phase.teacherActivity }}
                </p>
                <p v-if="phase.studentActivity" class="mt-1 text-ink-muted">
                  S: {{ phase.studentActivity }}
                </p>
                <p v-if="phase.method" class="mt-1 text-ink-subtle">Methode: {{ phase.method }}</p>
              </td>
              <td class="py-2">
                {{ phase.socialForm ? socialForms.label(phase.socialForm) : '–' }}
              </td>
            </tr>
          </tbody>
        </table>

        <p v-if="stunde.homework" class="text-sm">
          <strong>Hausaufgabe:</strong> {{ stunde.homework }}
        </p>
        <ul v-if="stunde.materials.length" class="mt-2 list-inside list-disc text-sm text-ink-muted">
          <li v-for="mat in stunde.materials" :key="mat.id">{{ mat.title }}</li>
        </ul>
      </section>
    </template>
  </div>
</template>
