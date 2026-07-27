<script setup lang="ts">
useHead({ title: 'Office-Editor' })

const { istAdmin } = useSitzung()
if (!istAdmin.value) await navigateTo('/einstellungen')

const { aufruf, laeuft } = useApi()

const { data, refresh } = await useFetch<{
  collabora: {
    enabled: boolean
    baseUrl: string
    wopiHostUrl: string
  }
}>('/api/settings')

const collabora = reactive({
  enabled: false,
  baseUrl: '',
  wopiHostUrl: '',
})

watch(
  data,
  (wert) => {
    if (!wert?.collabora) return
    Object.assign(collabora, wert.collabora)
  },
  { immediate: true },
)

async function speichern() {
  await aufruf('/api/settings/collabora', {
    method: 'PATCH',
    body: {
      enabled: collabora.enabled,
      baseUrl: collabora.baseUrl.trim(),
      wopiHostUrl: collabora.wopiHostUrl.trim(),
    },
    erfolgsmeldung: 'Collabora-Einstellungen gespeichert.',
  })
  await refresh()
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5">
    <LayoutSeitenkopf
      zurueck-to="/einstellungen"
      zurueck-label="Einstellungen"
      kicker="System"
      titel="Office-Editor"
      untertitel="Collabora Online zum Anzeigen und Bearbeiten von Word-, Excel- und PowerPoint-Dokumenten."
    />

    <UiCard titel="Collabora Online" icon="file-word">
      <p class="mb-4 text-sm text-ink-muted">
        PDF und Bilder werden in SARU direkt angezeigt. Für Word/Excel/PowerPoint kann optional ein
        Collabora-Online-Container (CODE) angebunden werden. Lehrkräfte und Admins können Dokumente
        dann im Browser bearbeiten und speichern; Leser erhalten eine schreibgeschützte Ansicht.
        Ohne Konfiguration erscheint „Vorschau nicht verfügbar“ mit Download-Hinweis.
        Textextraktion und Suche funktionieren unabhängig von Collabora.
      </p>
      <label class="mb-4 flex items-center gap-2 text-sm">
        <input v-model="collabora.enabled" type="checkbox" class="accent-[var(--color-primary)]">
        Collabora Office-Editor aktivieren
      </label>
      <div class="grid gap-4">
        <UiField
          label="Collabora-Basis-URL"
          hinweis="Muss im Browser öffnen. CODE mit SSL: https://host:9980 – ohne SSL: http://localhost:9980"
        >
          <UiInput
            v-model="collabora.baseUrl"
            placeholder="https://192.168.x.x:9980"
            :disabled="!collabora.enabled"
          />
        </UiField>
        <UiField
          label="WOPI-Host-URL (optional)"
          hinweis="URL, unter der Collabora SARU erreichen kann. Dev-Server muss dafür auf 0.0.0.0 lauschen (nicht nur localhost), z. B. http://192.168.x.x:3001 oder http://host.docker.internal:3000"
        >
          <UiInput
            v-model="collabora.wopiHostUrl"
            placeholder="http://192.168.x.x:3001"
            :disabled="!collabora.enabled"
          />
        </UiField>
      </div>
      <p
        v-if="collabora.enabled && collabora.baseUrl.startsWith('https://')"
        class="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-ink"
      >
        Selbstsigniertes Zertifikat: Öffnen Sie
        <a
          :href="collabora.baseUrl.replace(/\/+$/, '')"
          target="_blank"
          rel="noopener"
          class="font-medium text-primary underline"
        >{{ collabora.baseUrl.replace(/\/+$/, '') }}</a>
        einmal im selben Browser und akzeptieren Sie die Warnung.
        Sonst lädt der Vorschau-iframe (cool.html) nicht – Nuxt-Neustart hilft dagegen nicht.
      </p>
      <p class="mt-3 text-xs text-ink-subtle">
        Collabora braucht
        <code class="rounded bg-surface-sunken px-1 py-0.5">aliasgroup1</code>
        mit der exakten WOPI-Host-URL
        (<code class="rounded bg-surface-sunken px-1 py-0.5">{{ collabora.wopiHostUrl.trim() || 'https://saru.roesner.family' }}</code>).
        Produktion (HTTPS): Alias und
        <code class="rounded bg-surface-sunken px-1 py-0.5">frame-ancestors</code>
        müssen die SARU-Origin enthalten, z.&nbsp;B.
        <code class="mt-1 block break-all rounded bg-surface-sunken px-1 py-0.5">aliasgroup1=https://saru.roesner.family</code>
        und
        <code class="mt-1 block break-all rounded bg-surface-sunken px-1 py-0.5">--o:net.content_security_policy=frame-ancestors https://saru.roesner.family;</code>
        (ggf. plus Proxy-
        <code class="rounded bg-surface-sunken px-1 py-0.5">ssl.termination=true</code>).
        404er unter
        <code class="rounded bg-surface-sunken px-1 py-0.5">/browser/.../extensions/</code>
        oder
        <code class="rounded bg-surface-sunken px-1 py-0.5">/images/</code>
        kommen vom Collabora-/Proxy-Setup, nicht von SARU.
        Dev ohne SSL:
        <code class="mt-1 block break-all rounded bg-surface-sunken px-1 py-0.5">docker run -t -d -p 9980:9980 -e "aliasgroup1=http://192.168.x.x:3001,http://localhost:3001" -e "extra_params=--o:ssl.enable=false --o:ssl.termination=false" collabora/code</code>
      </p>
      <div class="mt-4 flex justify-end">
        <UiButton variante="primaer" icon="floppy-disk" :laedt="laeuft" @click="speichern">
          Speichern
        </UiButton>
      </div>
    </UiCard>
  </div>
</template>
