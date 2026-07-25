<script setup lang="ts">
import { roles } from '#shared/utils/labels'
import type { SitzungsBenutzer } from '~/composables/useSitzung'

defineProps<{ benutzer: SitzungsBenutzer | null; istAdmin: boolean }>()
defineEmits<{ abmelden: [] }>()

const offen = ref(false)
const wurzel = ref<HTMLElement | null>(null)

function initialen(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((teil) => teil[0]!.toUpperCase())
    .join('')
}

function beiKlickAussen(event: MouseEvent) {
  if (offen.value && !wurzel.value?.contains(event.target as Node)) offen.value = false
}

onMounted(() => document.addEventListener('click', beiKlickAussen))
onBeforeUnmount(() => document.removeEventListener('click', beiKlickAussen))
</script>

<template>
  <div v-if="benutzer" ref="wurzel" class="relative">
    <button
      type="button"
      class="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-hover"
      :aria-expanded="offen"
      aria-haspopup="menu"
      @click="offen = !offen"
    >
      <span
        class="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-strong"
      >
        {{ initialen(benutzer.name) }}
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium text-ink">{{ benutzer.name }}</span>
        <span class="block truncate text-xs text-ink-subtle">{{ roles.label(benutzer.role) }}</span>
      </span>
      <UiIcon name="chevron-up" class="shrink-0 text-xs text-ink-subtle transition-transform" :class="!offen && 'rotate-180'" />
    </button>

    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 translate-y-1"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="offen"
        role="menu"
        class="absolute bottom-full left-0 mb-2 w-full min-w-52 overflow-hidden rounded-lg border border-line bg-surface-raised py-1 shadow-[--shadow-raised]"
      >
        <p class="truncate px-3 py-2 text-xs text-ink-subtle">{{ benutzer.email }}</p>
        <div class="my-1 border-t border-line" />

        <NuxtLink
          to="/einstellungen/konto"
          class="flex items-center gap-2.5 px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
          role="menuitem"
          @click="offen = false"
        >
          <UiIcon name="user-gear" fest />
          Mein Konto
        </NuxtLink>
        <NuxtLink
          v-if="istAdmin"
          to="/einstellungen/benutzer"
          class="flex items-center gap-2.5 px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
          role="menuitem"
          @click="offen = false"
        >
          <UiIcon name="users" fest />
          Benutzerverwaltung
        </NuxtLink>

        <div class="my-1 border-t border-line" />
        <button
          type="button"
          class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-danger-soft"
          role="menuitem"
          @click="$emit('abmelden')"
        >
          <UiIcon name="right-from-bracket" fest />
          Abmelden
        </button>
      </div>
    </Transition>
  </div>
</template>
