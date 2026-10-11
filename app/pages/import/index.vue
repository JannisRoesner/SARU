<script setup lang="ts">
useHead({ title: 'Import' })

const { darfAnlegen } = useSitzung()
if (!darfAnlegen.value) await navigateTo('/')

/** Alles, was als Paket oder Archiv aus einem anderen System kommt – nach Quelle sortiert. */
const quellen = [
  {
    to: '/import/kursmappe',
    icon: 'file-import',
    titel: 'Schulportal-Kursmappe',
    text: 'ZIP-Export aus „mein Unterricht“.',
    ergebnis: 'Unterrichtsstunden',
  },
  {
    to: '/import/moodle',
    icon: 'graduation-cap',
    titel: 'Moodle-Kursarchiv',
    text: 'MBZ- oder IMSCC-Datei.',
    ergebnis: 'Material',
  },
  {
    to: '/import/stapel',
    icon: 'layer-group',
    titel: 'Ordner, ZIP oder mehrere Dateien',
    text: 'Viele Dateien auf einmal, z. B. Verlags-DVDs.',
    ergebnis: 'Materialien oder Lehrwerk',
  },
] as const
</script>

<template>
  <div>
    <LayoutSeitenkopf
      kicker="Import"
      titel="Import"
      untertitel="Pakete und Archive aus anderen Systemen"
    />

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <NuxtLink
        v-for="quelle in quellen"
        :key="quelle.to"
        :to="quelle.to"
        class="group flex flex-col rounded-xl border border-line bg-surface p-5 transition-colors hover:border-primary hover:bg-primary-soft/30"
      >
        <span
          class="mb-3 flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary transition-colors group-hover:bg-primary group-hover:text-white"
        >
          <UiIcon :name="quelle.icon" class="text-lg" fest />
        </span>
        <span class="font-semibold text-ink">{{ quelle.titel }}</span>
        <span class="mt-1 text-sm text-ink-muted">{{ quelle.text }}</span>
        <span class="mt-3 text-xs text-ink-subtle">
          <UiIcon name="arrow-right" class="mr-1" /> {{ quelle.ergebnis }}
        </span>
      </NuxtLink>
    </div>

    <p class="mt-6 text-sm text-ink-muted">
      Einzelne Datei?
      <NuxtLink to="/materialien/neu" class="font-medium text-primary hover:underline">
        Material anlegen
      </NuxtLink>
    </p>
  </div>
</template>
