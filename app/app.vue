<script setup lang="ts">
const { public: config } = useRuntimeConfig()

useHead({
  titleTemplate: (titel) => (titel ? `${titel} · ${config.appName}` : String(config.appName)),
})
</script>

<template>
  <div>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <UiHinweisliste />
  </div>
</template>
