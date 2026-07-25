<script setup lang="ts">
/**
 * Fallback-Route. Die Auth-Middleware leitet Gäste nach `/?anmelden=1` um;
 * angemeldete Nutzer nach `/`. Diese Seite wird praktisch nie gerendert.
 */
definePageMeta({ layout: 'landing' })
useHead({ title: 'Anmelden' })
</script>

<template>
  <div class="flex min-h-screen items-center justify-center text-sm text-ink-muted">
    Weiterleitung …
  </div>
</template>
