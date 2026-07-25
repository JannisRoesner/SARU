<script setup lang="ts">
const { benutzer, darfBearbeiten, istAdmin, abmelden } = useSitzung()
const route = useRoute()

const menueOffen = ref(false)
const suchePaletteOffen = ref(false)

interface NavEintrag {
  pfad: string
  label: string
  icon: string
  nurBearbeiter?: boolean
}

const HAUPTNAVIGATION: NavEintrag[] = [
  { pfad: '/', label: 'Dashboard', icon: 'gauge-high' },
  { pfad: '/materialien', label: 'Materialien', icon: 'folder-open' },
  { pfad: '/stunden', label: 'Unterrichtsstunden', icon: 'chalkboard-user' },
  { pfad: '/reihen', label: 'Unterrichtsreihen', icon: 'layer-group' },
  { pfad: '/suche', label: 'Suche', icon: 'magnifying-glass' },
]

const WERKZEUGE: NavEintrag[] = [
  { pfad: '/import', label: 'Import', icon: 'file-import', nurBearbeiter: true },
  { pfad: '/einstellungen', label: 'Einstellungen', icon: 'gear' },
]

const werkzeuge = computed(() => WERKZEUGE.filter((e) => !e.nurBearbeiter || darfBearbeiten.value))

function istAktiv(pfad: string) {
  return pfad === '/' ? route.path === '/' : route.path.startsWith(pfad)
}

// Bei einem Seitenwechsel schließt sich die mobile Navigation von selbst.
watch(() => route.fullPath, () => (menueOffen.value = false))

function beiTastenkuerzel(event: KeyboardEvent) {
  const imFeld = ['INPUT', 'TEXTAREA', 'SELECT'].includes(
    (event.target as HTMLElement)?.tagName ?? '',
  )
  if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
    event.preventDefault()
    suchePaletteOffen.value = true
  }
  if (event.key === '/' && !imFeld && !event.ctrlKey && !event.metaKey) {
    event.preventDefault()
    suchePaletteOffen.value = true
  }
}

onMounted(() => document.addEventListener('keydown', beiTastenkuerzel))
onBeforeUnmount(() => document.removeEventListener('keydown', beiTastenkuerzel))
</script>

<template>
  <div class="min-h-screen lg:flex">
    <a
      href="#inhalt"
      class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-lg focus:bg-primary-solid focus:px-4 focus:py-2 focus:text-primary-contrast"
    >
      Zum Inhalt springen
    </a>

    <!-- Seitenleiste -->
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-150"
      leave-to-class="opacity-0"
    >
      <div
        v-if="menueOffen"
        class="fixed inset-0 z-30 bg-slate-950/50 lg:hidden"
        @click="menueOffen = false"
      />
    </Transition>

    <aside
      class="fixed inset-y-0 left-0 z-40 flex h-screen w-64 shrink-0 flex-col border-r border-line bg-surface transition-transform duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] lg:sticky lg:top-0 lg:translate-x-0"
      :class="menueOffen ? 'translate-x-0' : '-translate-x-full'"
    >
      <div class="flex h-16 items-center gap-2.5 border-b border-line px-5">
        <NuxtLink to="/" class="flex items-center gap-2.5 font-semibold">
          <span
            class="flex size-9 items-center justify-center rounded-lg bg-primary-solid text-primary-contrast"
          >
            <UiIcon name="graduation-cap" />
          </span>
          <span>
            <span class="block leading-tight">SARU</span>
            <span class="block text-[0.65rem] leading-tight font-normal tracking-wide text-ink-subtle uppercase">
              Unterrichtsarchiv
            </span>
          </span>
        </NuxtLink>
        <UiButton
          variante="still"
          groesse="sm"
          icon="xmark"
          nur-icon
          class="ml-auto lg:hidden"
          title="Navigation schließen"
          @click="menueOffen = false"
        />
      </div>

      <nav class="min-h-0 flex-1 space-y-6 overflow-y-auto px-3 py-4" aria-label="Hauptnavigation">
        <ul class="space-y-0.5">
          <li v-for="eintrag in HAUPTNAVIGATION" :key="eintrag.pfad">
            <NuxtLink
              :to="eintrag.pfad"
              class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              :class="
                istAktiv(eintrag.pfad)
                  ? 'bg-primary-soft text-primary-strong'
                  : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
              "
              :aria-current="istAktiv(eintrag.pfad) ? 'page' : undefined"
            >
              <UiIcon :name="eintrag.icon" fest />
              {{ eintrag.label }}
            </NuxtLink>
          </li>
        </ul>

        <div>
          <p class="px-3 pb-1.5 text-[0.7rem] font-semibold tracking-wider text-ink-subtle uppercase">
            Verwaltung
          </p>
          <ul class="space-y-0.5">
            <li v-for="eintrag in werkzeuge" :key="eintrag.pfad">
              <NuxtLink
                :to="eintrag.pfad"
                class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                :class="
                  istAktiv(eintrag.pfad)
                    ? 'bg-primary-soft text-primary-strong'
                    : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
                "
              >
                <UiIcon :name="eintrag.icon" fest />
                {{ eintrag.label }}
              </NuxtLink>
            </li>
          </ul>
        </div>

        <div v-if="darfBearbeiten" class="px-3">
          <p class="pb-1.5 text-[0.7rem] font-semibold tracking-wider text-ink-subtle uppercase">
            Schnell anlegen
          </p>
          <div class="grid grid-cols-3 gap-1.5">
            <NuxtLink
              v-for="ziel in [
                { to: '/materialien/neu', icon: 'file-circle-plus', label: 'Material' },
                { to: '/stunden/neu', icon: 'calendar-plus', label: 'Stunde' },
                { to: '/reihen/neu', icon: 'layer-group', label: 'Reihe' },
              ]"
              :key="ziel.to"
              :to="ziel.to"
              class="flex flex-col items-center gap-1 rounded-lg border border-line px-1 py-2.5 text-[0.7rem] text-ink-muted transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary-strong"
              :title="`${ziel.label} anlegen`"
            >
              <UiIcon :name="ziel.icon" />
              {{ ziel.label }}
            </NuxtLink>
          </div>
        </div>
      </nav>

      <div class="mt-auto shrink-0 border-t border-line p-3">
        <LayoutBenutzermenue :benutzer="benutzer" :ist-admin="istAdmin" @abmelden="abmelden" />
      </div>
    </aside>

    <!-- Inhaltsbereich -->
    <div class="flex min-w-0 flex-1 flex-col">
      <header
        class="kein-druck sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur-md lg:px-8"
      >
        <UiButton
          variante="still"
          icon="bars"
          nur-icon
          class="lg:hidden"
          title="Navigation öffnen"
          @click="menueOffen = true"
        />

        <button
          type="button"
          class="flex h-10 max-w-md flex-1 items-center gap-2.5 rounded-lg border border-line bg-surface px-3 text-left text-sm text-ink-subtle transition-colors hover:border-line-strong hover:bg-surface-hover"
          @click="suchePaletteOffen = true"
        >
          <UiIcon name="magnifying-glass" />
          <span class="flex-1 truncate">Materialien, Stunden und Reihen durchsuchen …</span>
          <kbd
            class="hidden rounded border border-line bg-surface-sunken px-1.5 py-0.5 font-sans text-[0.7rem] text-ink-subtle sm:inline"
          >
            Strg K
          </kbd>
        </button>

        <div class="ml-auto flex items-center gap-1.5">
          <LayoutDarstellungsschalter />
        </div>
      </header>

      <main id="inhalt" class="flex-1 px-4 py-6 lg:px-8 lg:py-8">
        <slot />
      </main>
    </div>

    <SucheGlobalePalette v-model="suchePaletteOffen" />
  </div>
</template>
