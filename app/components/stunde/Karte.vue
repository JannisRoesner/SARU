<script setup lang="ts">
import { lessonStatuses } from '#shared/utils/labels'
import type { LessonSummary } from '~~/server/repositories/lesson.repository'

const props = withDefaults(
  defineProps<{
    stunde: LessonSummary
    kompakt?: boolean
    /** Blendet die Reihenzuordnung aus, wenn die Karte innerhalb einer Reihe steht. */
    ohneReihe?: boolean
  }>(),
  { kompakt: false, ohneReihe: false },
)

const fachfarbe = computed(() => props.stunde.subject?.color ?? null)
const stunden = computed(() => formatSchulstunden(props.stunde.periodFrom, props.stunde.periodTo))
</script>

<template>
  <NuxtLink
    :to="`/stunden/${stunde.id}`"
    class="karte group flex gap-3 p-4 transition-shadow hover:shadow-md"
  >
    <span
      class="flex size-12 shrink-0 flex-col items-center justify-center rounded-xl text-center leading-none"
      :style="fachfarbe ? { backgroundColor: `${fachfarbe}22`, color: fachfarbe } : undefined"
      :class="!fachfarbe && 'bg-primary-soft text-primary'"
    >
      <template v-if="stunde.date">
        <span class="text-lg font-semibold">{{ new Date(stunde.date).getDate() }}</span>
        <span class="mt-0.5 text-[0.65rem] uppercase">
          {{ new Date(stunde.date).toLocaleDateString('de-DE', { month: 'short' }) }}
        </span>
      </template>
      <UiIcon v-else name="calendar-xmark" fest />
    </span>

    <div class="min-w-0 flex-1">
      <div class="flex items-start gap-2">
        <h3 class="min-w-0 flex-1 font-medium text-ink group-hover:text-primary">
          {{ stunde.title }}
        </h3>
        <UiBadge
          groesse="sm"
          :ton="lessonStatuses.tone(stunde.status)"
          :icon="lessonStatuses.icon(stunde.status)"
        >
          {{ lessonStatuses.label(stunde.status) }}
        </UiBadge>
      </div>

      <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
        <span v-if="stunde.subject" class="flex items-center gap-1">
          <UiIcon name="palette" fest />{{ stunde.subject.name }}
        </span>
        <span v-if="stunde.learningGroup" class="flex items-center gap-1">
          <UiIcon name="users" fest />{{ stunde.learningGroup.name }}
        </span>
        <span v-if="stunde.date" class="flex items-center gap-1">
          <UiIcon name="calendar-day" fest />{{ formatDatumLang(stunde.date) }}
        </span>
        <span v-else-if="stunde.scheduleNote" class="flex items-center gap-1">
          <UiIcon name="clock" fest />{{ stunde.scheduleNote }}
        </span>
        <span v-if="stunden" class="flex items-center gap-1">
          <UiIcon name="hourglass-half" fest />{{ stunden }}
        </span>
      </div>

      <div
        v-if="!kompakt"
        class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-subtle"
      >
        <NuxtLink
          v-if="stunde.series && !ohneReihe"
          :to="`/reihen/${stunde.series.id}`"
          class="flex items-center gap-1 hover:text-primary"
          @click.stop
        >
          <UiIcon name="layer-group" fest />{{ stunde.series.title }}
          <template v-if="stunde.positionInSeries">· Stunde {{ stunde.positionInSeries }}</template>
        </NuxtLink>
        <span v-if="stunde.phaseCount" class="flex items-center gap-1">
          <UiIcon name="list-ol" fest />{{ stunde.phaseCount }} Phasen
        </span>
        <span v-if="stunde.materialCount" class="flex items-center gap-1">
          <UiIcon name="folder-open" fest />{{ stunde.materialCount }} Materialien
        </span>
        <span v-if="stunde.homework" class="flex items-center gap-1">
          <UiIcon name="house" fest />Hausaufgabe
        </span>
        <span v-if="stunde.substituteTeacher" class="flex items-center gap-1">
          <UiIcon name="user-clock" fest />Vertretung: {{ stunde.substituteTeacher }}
        </span>
      </div>
    </div>
  </NuxtLink>
</template>
