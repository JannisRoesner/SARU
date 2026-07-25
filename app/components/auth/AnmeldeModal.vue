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

watch(offen, (wert) => {
  if (wert) {
    fehler.value = null
    passwort.value = ''
  }
})

async function absenden() {
  fehler.value = null
  laeuft.value = true
  try {
    await anmelden(email.value, passwort.value)
    offen.value = false
    await navigateTo(props.weiter || '/')
  } catch (error) {
    fehler.value = toApiFehler(error).nachricht
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
    <form class="space-y-4" novalidate @submit.prevent="absenden">
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
        :disabled="!email || !passwort"
      >
        Anmelden
      </UiButton>
    </form>

    <p class="mt-4 text-center text-xs text-ink-subtle">
      Zugänge werden von der Administration vergeben.
    </p>
  </UiModal>
</template>
