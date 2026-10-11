<script setup lang="ts">
import type { GastMaterial } from '~~/server/services/share-view.service'

definePageMeta({ layout: 'geteilt' })
useHead({ title: 'Geteilter Zugang', meta: [{ name: 'robots', content: 'noindex, nofollow' }] })

const route = useRoute()
const { token, recht } = await useFreigabe()

const { data, error, refresh } = await useFetch<GastMaterial>(
  () => `/api/geteilt/${token.value}/materialien/${String(route.params.id)}`,
)
</script>

<template>
  <div>
    <NuxtLink :to="`/geteilt/${token}`" class="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary">
      <UiIcon name="arrow-left" fest /> Zur Übersicht
    </NuxtLink>
    <div v-if="error" class="rounded-xl border border-line bg-surface px-6 py-10 text-center">
      <p class="font-medium text-ink">Dieses Material ist über den Link nicht erreichbar.</p>
      <p class="mt-2 text-sm text-ink-muted">{{ toApiFehler(error).nachricht }}</p>
    </div>
    <GeteiltMaterial
      v-else-if="data"
      :token="token"
      :material="data"
      :recht="recht ?? 'ansehen'"
      @geaendert="refresh()"
    />
  </div>
</template>
