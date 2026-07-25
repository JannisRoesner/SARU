<script setup lang="ts">
import { seriesStatuses } from '#shared/utils/labels'
import type { SeriesSummary } from '~~/server/repositories/series.repository'

const props = defineProps<{ reihe: SeriesSummary }>()

const fachfarbe = computed(() => props.reihe.subject?.color ?? null)
const zeitraum = computed(() => formatZeitraum(props.reihe.startDate, props.reihe.endDate))
</script>

<template>
  <NuxtLink :to="`/reihen/${reihe.id}`" class="karte karte-klickbar group flex flex-col p-4">
    <div class="flex items-start gap-3">
      <span
        class="flex size-12 shrink-0 items-center justify-center rounded-xl text-lg"
        :style="fachfarbe ? { backgroundColor: `${fachfarbe}22`, color: fachfarbe } : undefined"
        :class="!fachfarbe && 'bg-accent-soft text-accent-strong'"
      >
        <UiIcon name="layer-group" fest />
      </span>

      <div class="min-w-0 flex-1">
        <div class="flex items-start gap-2">
          <h3 class="min-w-0 flex-1 font-medium text-ink group-hover:text-primary">
            {{ reihe.title }}
          </h3>
          <UiBadge
            groesse="sm"
            :ton="seriesStatuses.tone(reihe.status)"
            :icon="seriesStatuses.icon(reihe.status)"
          >
            {{ seriesStatuses.label(reihe.status) }}
          </UiBadge>
        </div>

        <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
          <span v-if="reihe.subject" class="flex items-center gap-1">
            <UiIcon name="palette" fest />{{ reihe.subject.name }}
          </span>
          <span v-if="reihe.learningGroup" class="flex items-center gap-1">
            <UiIcon name="users" fest />{{ reihe.learningGroup.name }}
          </span>
          <span v-if="zeitraum" class="flex items-center gap-1">
            <UiIcon name="calendar-range" fest />{{ zeitraum }}
          </span>
        </div>
      </div>
    </div>

    <p v-if="reihe.description" class="mt-3 line-clamp-2 text-sm text-ink-muted">
      {{ reihe.description }}
    </p>

    <div class="mt-3">
      <div class="mb-1 flex items-baseline justify-between text-xs">
        <span class="text-ink-muted">
          {{ reihe.progress.durchgefuehrt }} von {{ reihe.progress.total }} Stunden durchgeführt
        </span>
        <span class="font-medium text-ink">{{ reihe.progress.percent }} %</span>
      </div>
      <div
        class="h-1.5 overflow-hidden rounded-full bg-surface-sunken"
        role="progressbar"
        :aria-valuenow="reihe.progress.percent"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="`Fortschritt der Reihe ${reihe.title}`"
      >
        <div
          class="h-full rounded-full bg-primary transition-[width] duration-500"
          :style="{ width: `${reihe.progress.percent}%` }"
        />
      </div>
    </div>
  </NuxtLink>
</template>
