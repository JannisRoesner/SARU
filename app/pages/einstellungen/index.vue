<script setup lang="ts">
useHead({ title: 'Einstellungen' })

const { istAdmin, darfBearbeiten } = useSitzung()

const eintraege = computed(() =>
  [
    {
      to: '/einstellungen/konto',
      icon: 'user-gear',
      titel: 'Mein Konto',
      text: 'Name, Rolle und Passwort.',
      sichtbar: true,
    },
    {
      to: '/einstellungen/darstellung',
      icon: 'palette',
      titel: 'Darstellung',
      text: 'Farbmodus und Farbdesign für diese Instanz.',
      sichtbar: true,
    },
    {
      to: '/einstellungen/ki',
      icon: 'wand-magic-sparkles',
      titel: 'KI-Anbindung',
      text: 'Anbieter, Modelle und Test der Verbindung.',
      sichtbar: istAdmin.value,
    },
    {
      to: '/einstellungen/uploads',
      icon: 'cloud-arrow-up',
      titel: 'Uploads & Datenschutz',
      text: 'Dateigrößen, erlaubte Formate und Aufbewahrung.',
      sichtbar: istAdmin.value,
    },
    {
      to: '/einstellungen/benutzer',
      icon: 'users',
      titel: 'Benutzer',
      text: 'Zugänge anlegen, Rollen vergeben, Konten sperren.',
      sichtbar: istAdmin.value,
    },
  ].filter((e) => e.sichtbar),
)
</script>

<template>
  <div>
    <LayoutSeitenkopf
      kicker="Verwaltung"
      titel="Einstellungen"
      untertitel="Konto, Erscheinungsbild und – für Admins – Systemkonfiguration."
    />

    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <NuxtLink
        v-for="eintrag in eintraege"
        :key="eintrag.to"
        :to="eintrag.to"
        class="karte group flex gap-3 p-5 transition-shadow hover:shadow-md"
      >
        <span class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <UiIcon :name="eintrag.icon" fest />
        </span>
        <span>
          <span class="block font-semibold text-ink group-hover:text-primary">{{ eintrag.titel }}</span>
          <span class="mt-1 block text-sm text-ink-muted">{{ eintrag.text }}</span>
        </span>
      </NuxtLink>
    </div>

    <p v-if="!darfBearbeiten" class="mt-6 text-sm text-ink-subtle">
      Mit Leserecht kannst du Darstellung und Konto anpassen; Inhalte bleiben schreibgeschützt.
    </p>
  </div>
</template>
