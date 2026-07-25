<script setup lang="ts">
const { liste, schliessen } = useHinweise()

const STIL = {
  erfolg: { icon: 'circle-check', klasse: 'border-success/40 bg-success-soft text-success-strong' },
  fehler: { icon: 'circle-xmark', klasse: 'border-danger/40 bg-danger-soft text-danger-strong' },
  warnung: { icon: 'triangle-exclamation', klasse: 'border-warning/40 bg-warning-soft text-warning-strong' },
  info: { icon: 'circle-info', klasse: 'border-info/40 bg-info-soft text-info-strong' },
} as const
</script>

<template>
  <!--
    Meldungen entstehen ausschließlich durch Interaktion. Ein serverseitig
    gerendertes Teleport würde beim Hydratisieren nicht zusammenpassen, deshalb
    baut der Browser die Liste allein auf.
  -->
  <ClientOnly>
    <Teleport to="body">
      <div
        class="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
        role="status"
        aria-live="polite"
      >
        <TransitionGroup
          enter-active-class="transition duration-250 ease-[cubic-bezier(0.22,1,0.36,1)]"
          enter-from-class="opacity-0 translate-y-3 scale-95"
          leave-active-class="transition duration-150 ease-in absolute"
          leave-to-class="opacity-0 translate-x-4"
          move-class="transition duration-200"
        >
          <div
            v-for="hinweis in liste"
            :key="hinweis.id"
            class="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border bg-surface-raised p-3.5 shadow-[--shadow-raised]"
            :class="STIL[hinweis.art].klasse"
          >
            <UiIcon :name="STIL[hinweis.art].icon" class="mt-0.5 shrink-0" />
            <p class="min-w-0 flex-1 text-sm leading-snug text-ink">{{ hinweis.text }}</p>

            <button
              v-if="hinweis.aktion"
              type="button"
              class="shrink-0 rounded-md px-2 py-1 text-sm font-semibold underline-offset-2 hover:underline"
              @click="hinweis.aktion.ausfuehren(); schliessen(hinweis.id)"
            >
              {{ hinweis.aktion.text }}
            </button>

            <button
              type="button"
              class="shrink-0 rounded p-1 text-ink-subtle transition-colors hover:text-ink"
              title="Meldung schließen"
              @click="schliessen(hinweis.id)"
            >
              <UiIcon name="xmark" />
            </button>
          </div>
        </TransitionGroup>
      </div>
    </Teleport>
  </ClientOnly>
</template>
