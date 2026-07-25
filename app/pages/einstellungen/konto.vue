<script setup lang="ts">
import { roles } from '#shared/utils/labels'

useHead({ title: 'Mein Konto' })

const { benutzer, aktualisieren, abmelden } = useSitzung()
const { aufruf, laeuft } = useApi()

const aktuell = ref('')
const neu = ref('')
const wiederholung = ref('')
const felder = ref<Record<string, string[]>>({})

const erzwungen = computed(() => benutzer.value?.mustChangePassword === true)

const abweichung = computed(
  () => wiederholung.value.length > 0 && neu.value !== wiederholung.value,
)

const staerke = computed(() => {
  const wert = neu.value
  if (!wert) return null
  let punkte = 0
  if (wert.length >= 12) punkte++
  if (wert.length >= 16) punkte++
  if (/[a-z]/.test(wert) && /[A-Z]/.test(wert)) punkte++
  if (/\d/.test(wert)) punkte++
  if (/[^\w\s]/.test(wert)) punkte++
  const stufen = [
    { text: 'Sehr schwach', klasse: 'bg-danger', breite: '20%' },
    { text: 'Schwach', klasse: 'bg-danger', breite: '35%' },
    { text: 'Mittel', klasse: 'bg-warning', breite: '55%' },
    { text: 'Gut', klasse: 'bg-success', breite: '80%' },
    { text: 'Sehr gut', klasse: 'bg-success', breite: '100%' },
  ]
  return stufen[Math.min(punkte, stufen.length - 1)]
})

const absendbar = computed(
  () => aktuell.value.length > 0 && neu.value.length >= 12 && neu.value === wiederholung.value,
)

async function speichern() {
  felder.value = {}
  try {
    await aufruf('/api/auth/password', {
      method: 'PATCH',
      body: { currentPassword: aktuell.value, newPassword: neu.value },
      erfolgsmeldung: 'Passwort geändert.',
      stumm: true,
    })
  } catch (error) {
    const fehler = error as ApiFehler
    felder.value = fehler.felder
    useHinweise().fehler(fehler.nachricht)
    return
  }

  aktuell.value = ''
  neu.value = ''
  wiederholung.value = ''
  aktualisieren({ mustChangePassword: false })
  if (erzwungen.value) await navigateTo('/')
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <div v-if="!erzwungen" class="mb-2">
      <NuxtLink to="/einstellungen" class="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary">
        <UiIcon name="arrow-left" fest /> Einstellungen
      </NuxtLink>
    </div>

    <header>
      <h1 class="text-2xl font-semibold text-ink">Mein Konto</h1>
      <p class="mt-1 text-sm text-ink-muted">
        Zugangsdaten und persönliche Angaben.
      </p>
    </header>

    <div
      v-if="erzwungen"
      class="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-ink"
      role="alert"
    >
      <UiIcon name="triangle-exclamation" class="mt-0.5 shrink-0 text-warning" fest />
      <p>
        <strong class="font-medium">Passwort ändern erforderlich.</strong>
        Dieses Konto nutzt noch das vergebene Startpasswort. Bitte lege ein eigenes Passwort fest,
        um die übrigen Bereiche zu nutzen.
      </p>
    </div>

    <UiCard titel="Angaben zum Konto" icon="id-card">
      <dl class="grid gap-4 sm:grid-cols-2">
        <div>
          <dt class="text-xs uppercase tracking-wide text-ink-subtle">Name</dt>
          <dd class="mt-0.5 text-ink">{{ benutzer?.name }}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-wide text-ink-subtle">E-Mail-Adresse</dt>
          <dd class="mt-0.5 text-ink">{{ benutzer?.email }}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-wide text-ink-subtle">Rolle</dt>
          <dd class="mt-1">
            <UiBadge :icon="roles.icon(benutzer?.role)">{{ roles.label(benutzer?.role) }}</UiBadge>
          </dd>
        </div>
      </dl>
      <p class="mt-4 text-xs text-ink-subtle">
        Name, Adresse und Rolle werden von der Administration gepflegt.
      </p>
    </UiCard>

    <UiCard titel="Passwort ändern" icon="key">
      <form class="space-y-4" novalidate @submit.prevent="speichern">
        <UiField label="Aktuelles Passwort" pflicht :fehler="felder.currentPassword">
          <UiInput
            v-model="aktuell"
            type="password"
            icon="lock"
            autocomplete="current-password"
            :fehlerhaft="Boolean(felder.currentPassword)"
          />
        </UiField>

        <UiField
          label="Neues Passwort"
          pflicht
          hinweis="Mindestens 12 Zeichen. Eine längere Passphrase ist sicherer als Sonderzeichen."
          :fehler="felder.newPassword"
        >
          <UiInput
            v-model="neu"
            type="password"
            icon="key"
            autocomplete="new-password"
            :fehlerhaft="Boolean(felder.newPassword)"
          />
          <div v-if="staerke" class="mt-2 flex items-center gap-2">
            <div class="h-1 flex-1 overflow-hidden rounded-full bg-surface-sunken">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="staerke.klasse"
                :style="{ width: staerke.breite }"
              />
            </div>
            <span class="text-xs text-ink-muted">{{ staerke.text }}</span>
          </div>
        </UiField>

        <UiField
          label="Neues Passwort wiederholen"
          pflicht
          :fehler="abweichung ? 'Die Passwörter stimmen nicht überein.' : undefined"
        >
          <UiInput
            v-model="wiederholung"
            type="password"
            icon="key"
            autocomplete="new-password"
            :fehlerhaft="abweichung"
          />
        </UiField>

        <div class="flex justify-end gap-2 pt-1">
          <UiButton
            type="submit"
            variante="primaer"
            icon="floppy-disk"
            :laedt="laeuft"
            :disabled="!absendbar"
          >
            Passwort speichern
          </UiButton>
        </div>
      </form>
    </UiCard>

    <UiCard titel="Sitzung" icon="right-from-bracket">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-ink-muted">
          Meldet dieses Gerät ab. Andere Anmeldungen bleiben bestehen.
        </p>
        <UiButton variante="leise" icon="right-from-bracket" @click="abmelden">
          Abmelden
        </UiButton>
      </div>
    </UiCard>
  </div>
</template>
