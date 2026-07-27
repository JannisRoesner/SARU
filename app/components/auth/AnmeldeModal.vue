<script setup lang="ts">
const offen = defineModel<boolean>({ required: true })

const props = defineProps<{
  weiter?: string | null
}>()

const { anmelden } = useSitzung()

const email = ref('')
const passwort = ref('')
const laeuft = ref(false)
const fehler = ref<string | null>(null)
const formular = ref<HTMLFormElement | null>(null)

watch(offen, (wert) => {
  if (wert) {
    fehler.value = null
    passwort.value = ''
  }
})

/** Browser-Autofill (v. a. auf Smartphones) aktualisiert oft nicht v-model. */
function felderAusDom() {
  if (!formular.value) return
  const emailFeld = formular.value.querySelector<HTMLInputElement>('input[type="email"]')
  const passwortFeld = formular.value.querySelector<HTMLInputElement>('input[type="password"]')
  if (emailFeld?.value) email.value = emailFeld.value
  if (passwortFeld?.value) passwort.value = passwortFeld.value
}

async function absenden() {
  felderAusDom()
  fehler.value = null

  const emailNorm = email.value.trim()
  if (!emailNorm || !passwort.value) {
    fehler.value = 'Bitte E-Mail-Adresse und Passwort angeben.'
    return
  }

  laeuft.value = true
  try {
    await anmelden(emailNorm, passwort.value)
    offen.value = false
    await navigateTo(props.weiter || '/')
  } catch (error) {
    const apiFehler = toApiFehler(error)
    const feldMeldungen = Object.values(apiFehler.felder).flat()
    fehler.value = feldMeldungen[0] ?? apiFehler.nachricht
  } finally {
    laeuft.value = false
  }
}
</script>

<template>
  <UiModal
    v-model="offen"
    titel="Anmelden"
    beschreibung="Melde dich mit deinem Schulzugang an."
    icon="right-to-bracket"
    breite="sm"
  >
    <form
      ref="formular"
      class="space-y-4"
      novalidate
      @input="felderAusDom"
      @change="felderAusDom"
      @submit.prevent="absenden"
    >
      <UiField label="E-Mail-Adresse" pflicht>
        <UiInput
          v-model="email"
          type="email"
          icon="envelope"
          placeholder="name@schule.de"
          autocomplete="username"
          data-autofokus
          :fehlerhaft="Boolean(fehler)"
        />
      </UiField>

      <UiField label="Passwort" pflicht>
        <UiInput
          v-model="passwort"
          type="password"
          icon="lock"
          placeholder="••••••••"
          autocomplete="current-password"
          :fehlerhaft="Boolean(fehler)"
        />
      </UiField>

      <Transition
        enter-active-class="transition duration-200"
        enter-from-class="opacity-0 -translate-y-1"
      >
        <p
          v-if="fehler"
          class="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger"
          role="alert"
        >
          <UiIcon name="circle-exclamation" class="mt-0.5 shrink-0" />
          {{ fehler }}
        </p>
      </Transition>

      <UiButton
        type="submit"
        variante="primaer"
        breit
        groesse="lg"
        icon="right-to-bracket"
        :laedt="laeuft"
        :disabled="laeuft"
      >
        Anmelden
      </UiButton>
    </form>

    <p class="mt-4 text-center text-xs text-ink-subtle">
      Zugänge werden von der Administration vergeben.
    </p>
  </UiModal>
</template>
