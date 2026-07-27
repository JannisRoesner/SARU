<script setup lang="ts">
import { lessonStatuses, socialForms } from '#shared/utils/labels'
import type { LessonDetail } from '~~/server/repositories/lesson.repository'

definePageMeta({ layout: 'druck' })

const route = useRoute()
const id = computed(() => String(route.params.id))

const { data: stunde, error, refresh } = await useFetch<LessonDetail>(
  () => `/api/lessons/${id.value}`,
)

useHead({ title: () => (stunde.value ? `Druck · ${stunde.value.title}` : 'Druck') })

const gesamtDauer = computed(() =>
  (stunde.value?.phases ?? []).reduce((sum, p) => sum + (p.durationMinutes ?? 0), 0),
)

function drucken() {
  if (import.meta.client) window.print()
}
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-8 lg:px-8">
    <div class="kein-druck mb-6 flex flex-wrap items-center justify-between gap-3">
      <NuxtLink
        :to="`/stunden/${id}`"
        class="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary"
      >
        <UiIcon name="arrow-left" fest /> Zurück zur Stunde
      </NuxtLink>
      <UiButton variante="primaer" icon="print" @click="drucken">Drucken</UiButton>
    </div>

    <UiFehlerzustand v-if="error" :text="toApiFehler(error).nachricht" @erneut="refresh()" />

    <template v-else-if="stunde">
      <header class="mb-8 border-b border-line pb-6">
        <p class="text-xs font-semibold tracking-[0.14em] text-ink-subtle uppercase">
          Verlaufsplan · Unterrichtsstunde
        </p>
        <h1 class="mt-2 text-3xl tracking-tight text-ink">{{ stunde.title }}</h1>
        <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
          <span v-if="stunde.date">{{ formatDatumLang(stunde.date) }}</span>
          <span v-if="formatSchulstunden(stunde.periodFrom, stunde.periodTo)">
            {{ formatSchulstunden(stunde.periodFrom, stunde.periodTo) }}
          </span>
          <span v-if="stunde.subject">{{ stunde.subject.name }}</span>
          <span v-if="stunde.learningGroup">{{ stunde.learningGroup.name }}</span>
          <span v-if="stunde.topic">{{ stunde.topic.name }}</span>
          <span>{{ lessonStatuses.label(stunde.status) }}</span>
          <span v-if="gesamtDauer">{{ formatDauer(gesamtDauer) }}</span>
        </div>
        <p v-if="stunde.series" class="mt-2 text-sm text-ink-muted">
          Reihe: {{ stunde.series.title }}
          <span v-if="stunde.positionInSeries"> · Stunde {{ stunde.positionInSeries }}</span>
        </p>
        <p v-if="stunde.methodSummary" class="mt-4 text-sm">
          <strong>Methoden:</strong> {{ stunde.methodSummary }}
        </p>
        <p v-if="stunde.learningObjectives?.length" class="mt-3 text-sm">
          <strong>Lernziele:</strong> {{ stunde.learningObjectives.join(' · ') }}
        </p>
        <p v-if="stunde.notes" class="mt-3 text-sm leading-relaxed text-ink-muted">
          <strong>Notizen:</strong> {{ stunde.notes }}
        </p>
      </header>

      <section v-if="stunde.phases.length">
        <h2 class="mb-3 text-sm font-semibold tracking-wide text-ink-subtle uppercase">
          Phasenverlauf
        </h2>
        <table class="mb-6 w-full border-collapse text-sm">
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
                <p v-if="phase.notes" class="mt-1 text-ink-subtle">Hinweis: {{ phase.notes }}</p>
                <ul v-if="phase.materials?.length" class="mt-1 list-inside list-disc text-ink-muted">
                  <li v-for="mat in phase.materials" :key="mat.id">{{ mat.title }}</li>
                </ul>
              </td>
              <td class="py-2">
                {{ phase.socialForm ? socialForms.label(phase.socialForm) : '–' }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="stunde.materials.length" class="mb-6">
        <h2 class="mb-2 text-sm font-semibold tracking-wide text-ink-subtle uppercase">
          Stundenmaterialien
        </h2>
        <ul class="list-inside list-disc text-sm text-ink-muted">
          <li v-for="mat in stunde.materials" :key="mat.id">{{ mat.title }}</li>
        </ul>
      </section>

      <p v-if="stunde.homework" class="text-sm">
        <strong>Hausaufgabe:</strong> {{ stunde.homework }}
      </p>
    </template>
  </div>
</template>
