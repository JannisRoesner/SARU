<script setup lang="ts">
definePageMeta({ middleware: [] })
useHead({ title: 'Lehrwerk anlegen' })

const { darfBearbeiten } = useSitzung()
if (!darfBearbeiten.value) {
  await navigateTo('/lehrwerke')
}

const wege = [
  {
    to: '/lehrwerke/neu/klassisch',
    icon: 'book',
    titel: 'Klassisch',
    text: 'Titel, Verlag und Einordnung selbst ausfüllen – die Buchdatei optional anhängen.',
  },
  {
    to: '/lehrwerke/neu/ki',
    icon: 'wand-magic-sparkles',
    titel: 'Mit KI',
    text: 'Buchdatei hochladen – Titel, Beschreibung, Fach und Schlagwörter werden vorgeschlagen.',
  },
] as const
</script>

<template>
  <div>
    <LayoutSeitenkopf
      zurueck-to="/lehrwerke"
      zurueck-label="Alle Lehrwerke"
      kicker="Lehrwerke"
      titel="Lehrwerk anlegen"
      untertitel="Wähle den passenden Weg – alle Vorschläge kannst du vor dem Speichern anpassen."
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
      Einzelne Kopiervorlagen oder Arbeitsblätter?
      <NuxtLink to="/materialien/neu" class="font-medium text-primary hover:underline">
        Material anlegen
      </NuxtLink>
    </p>
  </div>
</template>
