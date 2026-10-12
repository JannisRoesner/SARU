<script setup lang="ts">
import type { GastStunde } from '~~/server/services/share-view.service'

definePageMeta({ layout: 'geteilt' })
useHead({ title: 'Geteilter Zugang', meta: [{ name: 'robots', content: 'noindex, nofollow' }] })

const route = useRoute()
const { token } = await useFreigabe()

const { data, error } = await useFetch<GastStunde>(
  () => `/api/geteilt/${token.value}/stunden/${String(route.params.id)}`,
)
</script>

<template>
  <div>
    <NuxtLink :to="`/geteilt/${token}`" class="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary">
      <UiIcon name="arrow-left" fest /> Zur Reihe
    </NuxtLink>
    <div v-if="error" class="rounded-xl border border-line bg-surface px-6 py-10 text-center">
      <p class="font-medium text-ink">Diese Stunde ist über den Link nicht erreichbar.</p>
      <p class="mt-2 text-sm text-ink-muted">{{ toApiFehler(error).nachricht }}</p>
    </div>
    <template v-else-if="data">
      <p class="text-xs font-semibold tracking-wider text-ink-subtle uppercase">Unterrichtsstunde</p>
      <h1 class="mt-1 text-2xl font-semibold text-ink">{{ data.title }}</h1>
      <p class="mt-1 text-sm text-ink-muted">
        {{ [data.date ? formatDatum(data.date) : null, data.durationMinutes ? `${data.durationMinutes} Minuten` : null].filter(Boolean).join(' · ') }}
      </p>
      <p v-if="data.methodSummary" class="mt-3 whitespace-pre-line text-ink-muted">{{ data.methodSummary }}</p>
      <ul v-if="data.learningObjectives.length" class="mt-3 list-inside list-disc text-sm text-ink-muted">
        <li v-for="ziel in data.learningObjectives" :key="ziel">{{ ziel }}</li>
      </ul>

      <UiCard v-if="data.phasen.length" titel="Verlauf" icon="list-ol" class="mt-6">
        <ol class="space-y-4">
          <li v-for="phase in data.phasen" :key="phase.id" class="border-l-2 border-primary/40 pl-4">
            <p class="font-medium text-ink">
              {{ phase.name }}
              <span v-if="phase.durationMinutes" class="text-sm font-normal text-ink-subtle">· {{ phase.durationMinutes }} Min.</span>
            </p>
            <p v-if="phase.content" class="mt-1 whitespace-pre-line text-sm text-ink-muted">{{ phase.content }}</p>
            <p v-if="phase.teacherActivity" class="mt-1 text-sm text-ink-muted"><strong>Lehrkraft:</strong> {{ phase.teacherActivity }}</p>
            <p v-if="phase.studentActivity" class="mt-1 text-sm text-ink-muted"><strong>Lernende:</strong> {{ phase.studentActivity }}</p>
            <p v-if="phase.method || phase.socialForm" class="mt-1 text-xs text-ink-subtle">
              {{ [phase.method, phase.socialForm].filter(Boolean).join(' · ') }}
            </p>
            <ul v-if="phase.materialien.length" class="mt-2 space-y-2">
              <li v-for="m in phase.materialien" :key="m.materialId">
                <GeteiltKarte :token="token" :material="{ ...m, id: m.materialId }" />
              </li>
            </ul>
          </li>
        </ol>
      </UiCard>

      <UiCard v-if="data.materialien.length" titel="Material" icon="folder-open" class="mt-4">
        <ul class="space-y-2">
          <li v-for="m in data.materialien" :key="m.materialId">
            <GeteiltKarte :token="token" :material="{ ...m, id: m.materialId }" />
          </li>
        </ul>
      </UiCard>

      <UiCard v-if="data.homework" titel="Hausaufgaben" icon="house" class="mt-4">
        <p class="whitespace-pre-line text-sm text-ink-muted">{{ data.homework }}</p>
      </UiCard>
    </template>
  </div>
</template>
