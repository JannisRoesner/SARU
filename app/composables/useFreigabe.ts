interface FreigabeInfo {
  recht: 'ansehen' | 'bearbeiten'
  erstelltVon: string
}

/**
 * Gemeinsamer Zustand der Gast-Seiten unter `/geteilt/<schlüssel>`.
 * Layout und Seiten teilen sich einen Abruf (gleicher Schlüssel), damit Server und
 * Browser identisch rendern.
 */
export async function useFreigabe() {
  const route = useRoute()
  const token = computed(() => String(route.params.token ?? ''))
  const { data: info } = await useFetch<FreigabeInfo>(() => `/api/geteilt/${token.value}/info`, {
    key: `geteilt-info-${token.value}`,
  })
  const recht = computed(() => info.value?.recht ?? null)
  const erstelltVon = computed(() => info.value?.erstelltVon ?? null)
  return { token, recht, erstelltVon }
}
