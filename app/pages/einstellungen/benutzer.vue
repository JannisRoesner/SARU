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
  <div>
    <div class="mb-2">
      <NuxtLink to="/einstellungen" class="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary">
        <UiIcon name="arrow-left" fest /> Einstellungen
      </NuxtLink>
    </div>

    <LayoutSeitenkopf
      kicker="Administration"
      titel="Benutzer"
      untertitel="Zugänge verwalten und Rollen zuweisen."
    >
      <template #aktionen>
        <UiButton variante="primaer" icon="user-plus" @click="anlegenOffen = true">
          Benutzer anlegen
        </UiButton>
      </template>
    </LayoutSeitenkopf>

    <div class="overflow-x-auto rounded-xl border border-line">
      <table class="w-full min-w-[40rem] text-left text-sm">
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
        <UiField label="Startpasswort" pflicht>
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

    <UiConfirm
      v-model="loeschenOffen"
      gefahr
      titel="Benutzer löschen?"
      :text="loeschenZiel ? `„${loeschenZiel.name}“ wird dauerhaft entfernt.` : ''"
      bestaetigen="Löschen"
      @bestaetigt="loeschen"
    />
  </div>
</template>
