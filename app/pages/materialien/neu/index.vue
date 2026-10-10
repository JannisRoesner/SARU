<script setup lang="ts">
definePageMeta({ middleware: [] })
useHead({ title: 'Material anlegen' })

const { darfBearbeiten } = useSitzung()
if (!darfBearbeiten.value) {
  await navigateTo('/materialien')
}

const wege = [
  {
    to: '/materialien/neu/klassisch',
    icon: 'file-lines',
    titel: 'Klassisch',
    text: 'Angaben selbst setzen.',
  },
  {
    to: '/materialien/neu/ki',
    icon: 'wand-magic-sparkles',
    titel: 'Mit KI',
    text: 'Metadaten aus der Datei.',
  },
] as const
</script>

<template>
  <div>
    <LayoutSeitenkopf
      zurueck-to="/materialien"
      zurueck-label="Alle Materialien"
      kicker="Materialien"
      titel="Material anlegen"
      untertitel="Klassisch oder KI"
    />

    <div class="grid gap-4 sm:grid-cols-2">
      <NuxtLink
        v-for="weg in wege"
        :key="weg.to"
        :to="weg.to"
        class="group flex flex-col rounded-xl border border-line bg-surface p-5 transition-colors hover:border-primary hover:bg-primary-soft/30"
      >
        <span
          class="mb-3 flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary transition-colors group-hover:bg-primary group-hover:text-white"
        >
          <UiIcon :name="weg.icon" class="text-lg" fest />
        </span>
        <span class="font-semibold text-ink">{{ weg.titel }}</span>
        <span class="mt-1 text-sm text-ink-muted">{{ weg.text }}</span>
      </NuxtLink>
    </div>

    <p class="mt-6 text-sm text-ink-muted">
      Mehrere Dateien, ein Ordner oder ein Moodle-Archiv?
      <NuxtLink to="/import" class="font-medium text-primary hover:underline">Import</NuxtLink>
      · Schulbuch?
      <NuxtLink to="/lehrwerke/neu" class="font-medium text-primary hover:underline">
        Lehrwerk anlegen
      </NuxtLink>
    </p>
  </div>
</template>
