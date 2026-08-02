<script setup lang="ts">
definePageMeta({
  layout: 'landing',
})

const route = useRoute()
const router = useRouter()
const { angemeldet } = useSitzung()

useHead({
  title: () =>
    angemeldet.value
      ? 'Dashboard'
      : 'SARU — System zur Archivierung von Reihen und Unterrichtsmaterialien',
})

const anmeldeOffen = ref(
  !angemeldet.value && (route.query.anmelden === '1' || route.query.anmelden === 'true'),
)

const weiter = computed(() =>
  typeof route.query.weiter === 'string' ? route.query.weiter : null,
)

watch(
  () => route.query.anmelden,
  (wert) => {
    if (!angemeldet.value && (wert === '1' || wert === 'true')) {
      anmeldeOffen.value = true
    }
  },
)

watch(anmeldeOffen, (offen) => {
  if (offen || angemeldet.value) return
  // Modal schließen → Query bereinigen, Landing bleibt.
  if (route.query.anmelden) {
    const { anmelden: _a, ...rest } = route.query
    void router.replace({ path: '/', query: rest })
  }
})

function anmeldenOeffnen() {
  anmeldeOffen.value = true
  if (!route.query.anmelden) {
    void router.replace({ path: '/', query: { ...route.query, anmelden: '1' } })
  }
}
</script>

<template>
  <StartDashboard v-if="angemeldet" />
  <div v-else class="contents">
    <StartLanding @anmelden="anmeldenOeffnen" />
    <AuthAnmeldeModal v-model="anmeldeOffen" :weiter="weiter" />
  </div>
</template>
