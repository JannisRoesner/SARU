<script setup lang="ts">
/** Layout für Freigabe-Links: kein Archiv, keine Navigation – nur das Geteilte. */
const { recht, erstelltVon } = await useFreigabe()
</script>

<template>
  <div class="min-h-screen bg-canvas">
    <header class="border-b border-line bg-surface">
      <div class="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 lg:px-8">
        <span class="flex items-center gap-2 font-semibold text-ink">
          <UiIcon name="share-nodes" class="text-primary" fest />
          Geteilter Zugang
        </span>
        <UiBadge v-if="recht" :icon="recht === 'bearbeiten' ? 'pen-to-square' : 'eye'">
          {{ recht === 'bearbeiten' ? 'Bearbeiten' : 'Ansehen' }}
        </UiBadge>
        <span v-if="erstelltVon" class="text-sm text-ink-muted">geteilt von {{ erstelltVon }}</span>
        <span class="ml-auto text-right">
          <span class="block text-sm leading-tight font-semibold text-ink">SARU</span>
          <span class="block text-[0.7rem] leading-tight text-ink-subtle">
            <b class="font-bold text-primary">S</b>ystem zur <b class="font-bold text-primary">A</b>rchivierung von
            <b class="font-bold text-primary">R</b>eihen und <b class="font-bold text-primary">U</b>nterrichtsmaterialien
          </span>
        </span>
      </div>
    </header>
    <main class="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
      <slot />
    </main>
  </div>
</template>
