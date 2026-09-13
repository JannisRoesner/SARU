<script setup lang="ts">
import { roles } from '#shared/utils/labels'
import type { Role } from '#shared/types/domain'

useHead({ title: 'Benutzer' })

const { istAdmin, benutzer: selbst } = useSitzung()
if (!istAdmin.value) await navigateTo('/einstellungen')

const { aufruf, laeuft } = useApi()

interface Benutzer {
  id: string
  email: string
  name: string
  role: Role
  isActive: boolean
  mustChangePassword: boolean
  createdAt: string
  lastLoginAt: string | null
}

const { data, refresh } = await useFetch<{ items: Benutzer[] }>('/api/users')

const anlegenOffen = ref(false)
const loeschenZiel = ref<Benutzer | null>(null)
const loeschenOffen = computed({
  get: () => loeschenZiel.value !== null,
  set: (wert: boolean) => {
    if (!wert) loeschenZiel.value = null
  },
})

const passwortZiel = ref<Benutzer | null>(null)
const passwortOffen = computed({
  get: () => passwortZiel.value !== null,
  set: (wert: boolean) => {
    if (!wert) passwortZiel.value = null
  },
})
const passwort = reactive({
  neu: '',
  wiederholung: '',
  mustChangePassword: true,
})

watch(passwortZiel, (ziel) => {
  if (!ziel) return
  passwort.neu = ''
  passwort.wiederholung = ''
  passwort.mustChangePassword = true
})

const passwortAbweichung = computed(
  () => passwort.wiederholung.length > 0 && passwort.neu !== passwort.wiederholung,
)
const passwortAbsendbar = computed(
  () => passwort.neu.length >= 10 && passwort.neu === passwort.wiederholung,
)

const neu = reactive({
  name: '',
  email: '',
  password: '',
  role: 'lehrkraft' as Role,
  mustChangePassword: true,
})

async function anlegen() {
  const ok = await aufruf('/api/users', {
    method: 'POST',
    body: { ...neu },
    erfolgsmeldung: 'Benutzer angelegt.',
  })
  if (ok) {
    anlegenOffen.value = false
    neu.name = ''
    neu.email = ''
    neu.password = ''
    await refresh()
  }
}

async function rolleAendern(id: string, role: Role) {
  await aufruf(`/api/users/${id}`, {
    method: 'PATCH',
    body: { role },
    erfolgsmeldung: 'Rolle aktualisiert.',
  })
  await refresh()
}

async function aktivUmschalten(user: Benutzer) {
  await aufruf(`/api/users/${user.id}`, {
    method: 'PATCH',
    body: { isActive: !user.isActive },
    erfolgsmeldung: user.isActive ? 'Benutzer deaktiviert.' : 'Benutzer aktiviert.',
  })
  await refresh()
}

async function passwortSetzen() {
  if (!passwortZiel.value || !passwortAbsendbar.value) return
  const ok = await aufruf(`/api/users/${passwortZiel.value.id}`, {
    method: 'PATCH',
    body: {
      password: passwort.neu,
      mustChangePassword: passwort.mustChangePassword,
    },
    erfolgsmeldung: 'Passwort gesetzt. Bestehende Anmeldungen wurden beendet.',
  })
  if (ok) {
    passwortZiel.value = null
    await refresh()
  }
}

async function loeschen() {
  if (!loeschenZiel.value) return
  const ok = await aufruf(`/api/users/${loeschenZiel.value.id}`, {
    method: 'DELETE',
    erfolgsmeldung: 'Benutzer gelöscht.',
  })
  loeschenZiel.value = null
  if (ok !== null) await refresh()
}
</script>

<template>
  <LayoutEinstellungsSeite>
    <LayoutSeitenkopf
      zurueck-to="/einstellungen"
      zurueck-label="Einstellungen"
      kicker="Administration"
      titel="Benutzer"
      untertitel="Zugänge, Rollen, Passwörter"
    >
      <template #aktionen>
        <UiButton variante="primaer" icon="user-plus" @click="anlegenOffen = true">
          Benutzer anlegen
        </UiButton>
      </template>
    </LayoutSeitenkopf>

    <ul class="space-y-2 md:hidden">
      <li
        v-for="user in data?.items ?? []"
        :key="user.id"
        class="karte space-y-3 p-4"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="font-medium text-ink">
              {{ user.name }}
              <span v-if="user.id === selbst?.id" class="text-xs font-normal text-ink-subtle">(du)</span>
            </p>
            <p class="truncate text-sm text-ink-muted">{{ user.email }}</p>
          </div>
          <div class="flex shrink-0">
            <UiButton
              v-if="user.id !== selbst?.id"
              variante="still"
              groesse="sm"
              icon="key"
              nur-icon
              title="Passwort setzen"
              @click="passwortZiel = user"
            />
            <UiButton
              v-if="user.id !== selbst?.id"
              variante="still"
              groesse="sm"
              :icon="user.isActive ? 'ban' : 'check'"
              nur-icon
              :title="user.isActive ? 'Deaktivieren' : 'Aktivieren'"
              @click="aktivUmschalten(user)"
            />
            <UiButton
              v-if="user.id !== selbst?.id"
              variante="still"
              groesse="sm"
              icon="trash"
              nur-icon
              title="Löschen"
              @click="loeschenZiel = user"
            />
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <select
            class="rounded-lg border border-line bg-surface px-2 py-1 text-sm"
            :value="user.role"
            :disabled="user.id === selbst?.id"
            @change="rolleAendern(user.id, ($event.target as HTMLSelectElement).value as Role)"
          >
            <option v-for="r in roles.options()" :key="r.value" :value="r.value">
              {{ r.label }}
            </option>
          </select>
          <UiBadge :ton="user.isActive ? 'gruen' : 'neutral'">
            {{ user.isActive ? 'Aktiv' : 'Gesperrt' }}
          </UiBadge>
          <UiBadge v-if="user.mustChangePassword" ton="gelb">Passwort</UiBadge>
        </div>
      </li>
    </ul>

    <div class="hidden overflow-x-auto rounded-xl border border-line md:block">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-line bg-surface-sunken text-xs tracking-wide text-ink-subtle uppercase">
          <tr>
            <th class="px-4 py-3 font-semibold">Name</th>
            <th class="px-4 py-3 font-semibold">E-Mail</th>
            <th class="px-4 py-3 font-semibold">Rolle</th>
            <th class="px-4 py-3 font-semibold">Status</th>
            <th class="px-4 py-3 font-semibold" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="user in data?.items ?? []"
            :key="user.id"
            class="border-b border-line last:border-0"
          >
            <td class="px-4 py-3 font-medium text-ink">
              {{ user.name }}
              <span v-if="user.id === selbst?.id" class="ml-1 text-xs text-ink-subtle">(du)</span>
            </td>
            <td class="px-4 py-3 text-ink-muted">{{ user.email }}</td>
            <td class="px-4 py-3">
              <select
                class="rounded-lg border border-line bg-surface px-2 py-1 text-sm"
                :value="user.role"
                :disabled="user.id === selbst?.id"
                @change="rolleAendern(user.id, ($event.target as HTMLSelectElement).value as Role)"
              >
                <option v-for="r in roles.options()" :key="r.value" :value="r.value">
                  {{ r.label }}
                </option>
              </select>
            </td>
            <td class="px-4 py-3">
              <UiBadge :ton="user.isActive ? 'gruen' : 'neutral'">
                {{ user.isActive ? 'Aktiv' : 'Gesperrt' }}
              </UiBadge>
              <UiBadge v-if="user.mustChangePassword" ton="gelb">Passwort</UiBadge>
            </td>
            <td class="px-4 py-3 text-right">
              <UiButton
                v-if="user.id !== selbst?.id"
                variante="still"
                groesse="sm"
                icon="key"
                nur-icon
                title="Passwort setzen"
                @click="passwortZiel = user"
              />
              <UiButton
                v-if="user.id !== selbst?.id"
                variante="still"
                groesse="sm"
                :icon="user.isActive ? 'ban' : 'check'"
                nur-icon
                :title="user.isActive ? 'Deaktivieren' : 'Aktivieren'"
                @click="aktivUmschalten(user)"
              />
              <UiButton
                v-if="user.id !== selbst?.id"
                variante="still"
                groesse="sm"
                icon="trash"
                nur-icon
                title="Löschen"
                @click="loeschenZiel = user"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <UiModal v-model="anlegenOffen" titel="Benutzer anlegen" icon="user-plus">
      <div class="space-y-4">
        <UiField label="Name" pflicht>
          <UiInput v-model="neu.name" data-autofokus />
        </UiField>
        <UiField label="E-Mail" pflicht>
          <UiInput v-model="neu.email" type="email" />
        </UiField>
        <UiField label="Startpasswort" pflicht hinweis="Mindestens 10 Zeichen, drei Zeichenarten.">
          <UiInput v-model="neu.password" type="password" autocomplete="new-password" />
        </UiField>
        <UiField label="Rolle">
          <UiSelect
            v-model="neu.role"
            :optionen="roles.options().map((o) => ({ value: o.value, label: o.label }))"
          />
        </UiField>
        <label class="flex items-center gap-2 text-sm">
          <input v-model="neu.mustChangePassword" type="checkbox" class="accent-[var(--color-primary)]">
          Passwortwechsel beim nächsten Login erzwingen
        </label>
      </div>
      <template #aktionen>
        <UiButton variante="sekundaer" @click="anlegenOffen = false">Abbrechen</UiButton>
        <UiButton
          variante="primaer"
          :laedt="laeuft"
          :disabled="!neu.name || !neu.email || !neu.password"
          @click="anlegen"
        >
          Anlegen
        </UiButton>
      </template>
    </UiModal>

    <UiModal
      v-model="passwortOffen"
      titel="Passwort setzen"
      icon="key"
      :beschreibung="passwortZiel ? `Neues Passwort für ${passwortZiel.name}.` : undefined"
    >
      <div class="space-y-4">
        <UiField label="Neues Passwort" pflicht hinweis="Mindestens 10 Zeichen, drei Zeichenarten.">
          <UiInput
            v-model="passwort.neu"
            type="password"
            autocomplete="new-password"
            data-autofokus
          />
        </UiField>
        <UiField
          label="Passwort wiederholen"
          pflicht
          :fehler="passwortAbweichung ? 'Die Passwörter stimmen nicht überein.' : undefined"
        >
          <UiInput
            v-model="passwort.wiederholung"
            type="password"
            autocomplete="new-password"
            :fehlerhaft="passwortAbweichung"
          />
        </UiField>
        <label class="flex items-center gap-2 text-sm">
          <input v-model="passwort.mustChangePassword" type="checkbox" class="accent-[var(--color-primary)]">
          Wechsel beim nächsten Login erzwingen
        </label>
      </div>
      <template #aktionen>
        <UiButton variante="sekundaer" @click="passwortOffen = false">Abbrechen</UiButton>
        <UiButton
          variante="primaer"
          :laedt="laeuft"
          :disabled="!passwortAbsendbar"
          @click="passwortSetzen"
        >
          Passwort setzen
        </UiButton>
      </template>
    </UiModal>

    <UiConfirm
      v-model="loeschenOffen"
      gefahr
      titel="Benutzer löschen?"
      :text="loeschenZiel ? `„${loeschenZiel.name}“ wird dauerhaft entfernt.` : ''"
      bestaetigen="Löschen"
      @bestaetigt="loeschen"
    />
  </LayoutEinstellungsSeite>
</template>
