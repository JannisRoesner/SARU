<script setup lang="ts">
const emit = defineEmits<{ anmelden: [] }>()

const features = [
  {
    icon: 'folder-open',
    titel: 'Materialien sammeln',
    text: 'Arbeitsblätter, Präsentationen und Anhänge mit Varianten, Favoriten und klarer Einordnung nach Fach und Jahrgang.',
  },
  {
    icon: 'magnifying-glass',
    titel: 'Hybrid suchen',
    text: 'Volltext und optionale Vektorsuche finden Inhalte über Titel, Notizen und extrahierten Dateitext hinweg.',
  },
  {
    icon: 'chalkboard-user',
    titel: 'Stunden planen',
    text: 'Verlaufspläne mit Phasen, Sozialformen und zugeordneten Materialien – per Drag-and-drop sortierbar.',
  },
  {
    icon: 'layer-group',
    titel: 'Reihen denken',
    text: 'Unterrichtsreihen als Timeline mit Fortschritt, Druckansicht und wiederverwendbaren Materialien.',
  },
  {
    icon: 'file-import',
    titel: 'SchulPortal importieren',
    text: 'Kursmappen analysieren, Dubletten erkennen, zuordnen und kontrolliert übernehmen – inkl. Rückgängig.',
  },
  {
    icon: 'wand-magic-sparkles',
    titel: 'KI-Musterlösungen',
    text: 'Optional Lösungen erzeugen, klar als KI kennzeichnen und mit dem Ausgangsmaterial verknüpfen.',
  },
]

const schritte = [
  { nr: '01', titel: 'Sammeln', text: 'Materialien anlegen oder aus dem SchulPortal importieren.' },
  { nr: '02', titel: 'Ordnen', text: 'Nach Fach, Thema und Lerngruppe einordnen – wiederauffindbar.' },
  { nr: '03', titel: 'Planen', text: 'Stunden und Reihen mit Phasen und Materialien aufbauen.' },
  { nr: '04', titel: 'Unterrichten', text: 'Schnell finden, wiederverwenden, Fortschritt im Blick behalten.' },
]

const mehr = [
  { icon: 'users', titel: 'Rollen & Rechte', text: 'Admin, Lehrkraft und Leserecht – klar getrennt.' },
  { icon: 'palette', titel: 'Erscheinungsbild', text: 'Hell, Dunkel oder System plus ruhige Farbpaletten.' },
  { icon: 'server', titel: 'Self-Hosted', text: 'Deine Daten bleiben in deiner Instanz.' },
  { icon: 'print', titel: 'Druckansicht', text: 'Verlaufspläne sauber für die Mappe exportieren.' },
]
</script>

<template>
  <div class="landing">
    <header class="landing-nav kein-druck">
      <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="#oben" class="flex items-center gap-2.5 font-semibold tracking-tight">
          <span class="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-contrast">
            <UiIcon name="graduation-cap" />
          </span>
          <span>
            <span class="block leading-none">SARU</span>
            <span class="mt-0.5 block text-[0.65rem] font-normal tracking-[0.12em] text-ink-subtle uppercase">
              Unterrichtsarchiv
            </span>
          </span>
        </a>
        <nav class="hidden items-center gap-6 text-sm text-ink-muted md:flex">
          <a href="#funktionen" class="transition-colors hover:text-ink">Funktionen</a>
          <a href="#ablauf" class="transition-colors hover:text-ink">Ablauf</a>
          <a href="#mehr" class="transition-colors hover:text-ink">Mehr</a>
        </nav>
        <UiButton variante="primaer" icon="right-to-bracket" @click="emit('anmelden')">
          Anmelden
        </UiButton>
      </div>
    </header>

    <main id="oben">
      <section class="landing-hero relative overflow-hidden">
        <div class="landing-hero-glow" aria-hidden="true" />
        <div class="relative mx-auto max-w-6xl px-4 pt-20 pb-24 sm:px-6 sm:pt-28 sm:pb-32">
          <p class="seitenkopf-kicker animate-landing-in">Unterricht. Archiviert. Wiedergefunden.</p>
          <h1 class="mt-3 max-w-3xl text-4xl leading-[1.1] tracking-tight text-ink sm:text-5xl lg:text-[3.5rem] animate-landing-in animate-landing-delay-1">
            Dein Archiv für Materialien, Stunden und Reihen
          </h1>
          <p class="mt-5 max-w-xl text-base leading-relaxed text-ink-muted sm:text-lg animate-landing-in animate-landing-delay-2">
            SARU hält Unterrichtsmaterialien, Verlaufspläne und Reihen an einem Ort –
            durchsuchbar, importierbar und für den Alltag an der Schule gemacht.
          </p>
          <div class="mt-8 flex flex-wrap gap-3 animate-landing-in animate-landing-delay-3">
            <UiButton variante="primaer" groesse="lg" icon="right-to-bracket" @click="emit('anmelden')">
              Anmelden
            </UiButton>
            <a
              href="#funktionen"
              class="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-5 text-base font-medium text-ink transition-all hover:border-line-strong hover:bg-surface-hover"
            >
              <UiIcon name="arrow-down" fest />
              Funktionen entdecken
            </a>
          </div>
        </div>
      </section>

      <section id="funktionen" class="border-t border-line bg-surface/60 py-20 sm:py-24">
        <div class="mx-auto max-w-6xl px-4 sm:px-6">
          <div class="seitenkopf mb-12 !max-w-2xl">
            <p class="seitenkopf-kicker">Funktionen</p>
            <h2 class="text-3xl tracking-tight text-ink sm:text-4xl">
              Alles für die Vorbereitung – ruhig und klar
            </h2>
            <p class="mt-3 text-sm leading-relaxed text-ink-muted sm:text-base">
              Wenige Oberflächen, starke Typografie, kurze Wege. Vom Material bis zur Reihe.
            </p>
          </div>

          <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <article
              v-for="(f, i) in features"
              :key="f.titel"
              class="landing-card group"
              :style="{ animationDelay: `${i * 40}ms` }"
            >
              <span class="mb-4 flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary transition-transform duration-300 group-hover:scale-105">
                <UiIcon :name="f.icon" fest />
              </span>
              <h3 class="text-lg font-semibold tracking-tight text-ink">{{ f.titel }}</h3>
              <p class="mt-2 text-sm leading-relaxed text-ink-muted">{{ f.text }}</p>
            </article>
          </div>
        </div>
      </section>

      <section id="ablauf" class="py-20 sm:py-24">
        <div class="mx-auto max-w-6xl px-4 sm:px-6">
          <div class="seitenkopf mb-12 !max-w-2xl">
            <p class="seitenkopf-kicker">Ablauf</p>
            <h2 class="text-3xl tracking-tight text-ink sm:text-4xl">
              Vom Fundstück zum Unterricht
            </h2>
            <p class="mt-3 text-sm leading-relaxed text-ink-muted sm:text-base">
              Vier Schritte – nachvollziehbar und ohne Ballast.
            </p>
          </div>

          <ol class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <li
              v-for="schritt in schritte"
              :key="schritt.nr"
              class="landing-card relative"
            >
              <span class="schrift-display text-3xl text-primary/25">{{ schritt.nr }}</span>
              <h3 class="mt-2 font-semibold text-ink">{{ schritt.titel }}</h3>
              <p class="mt-1.5 text-sm leading-relaxed text-ink-muted">{{ schritt.text }}</p>
            </li>
          </ol>
        </div>
      </section>

      <section id="mehr" class="border-t border-line bg-surface/60 py-20 sm:py-24">
        <div class="mx-auto max-w-6xl px-4 sm:px-6">
          <div class="seitenkopf mb-12 !max-w-2xl">
            <p class="seitenkopf-kicker">Und mehr</p>
            <h2 class="text-3xl tracking-tight text-ink sm:text-4xl">
              Für den Schulalltag gebaut
            </h2>
          </div>
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <article v-for="eintrag in mehr" :key="eintrag.titel" class="landing-card">
              <UiIcon :name="eintrag.icon" class="mb-3 text-primary" />
              <h3 class="font-semibold text-ink">{{ eintrag.titel }}</h3>
              <p class="mt-1.5 text-sm text-ink-muted">{{ eintrag.text }}</p>
            </article>
          </div>
        </div>
      </section>

      <section class="py-20 sm:py-28">
        <div class="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <p class="seitenkopf-kicker justify-center">Bereit?</p>
          <h2 class="mt-2 text-3xl tracking-tight text-ink sm:text-4xl">
            Starte mit deinem Unterrichtsarchiv
          </h2>
          <p class="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-ink-muted sm:text-base">
            Melde dich an, lege Materialien an oder importiere eine Kursmappe aus dem SchulPortal.
          </p>
          <div class="mt-8 flex justify-center">
            <UiButton variante="primaer" groesse="lg" icon="right-to-bracket" @click="emit('anmelden')">
              Anmelden
            </UiButton>
          </div>
        </div>
      </section>
    </main>

    <footer class="border-t border-line py-8">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 text-xs text-ink-subtle sm:px-6">
        <span>SARU · System zur Archivierung von Reihen und Unterrichtsmaterialien</span>
        <button type="button" class="hover:text-ink" @click="emit('anmelden')">
          Anmelden
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.landing-nav {
  position: sticky;
  top: 0;
  z-index: 30;
  border-bottom: 1px solid color-mix(in oklab, var(--surface-line) 80%, transparent);
  background: color-mix(in oklab, var(--surface-canvas) 82%, transparent);
  backdrop-filter: blur(12px);
}

.landing-hero-glow {
  position: absolute;
  inset: -20% -10% auto;
  height: 70%;
  background:
    radial-gradient(ellipse 60% 50% at 20% 30%, color-mix(in oklab, var(--palette-primary) 16%, transparent), transparent 70%),
    radial-gradient(ellipse 50% 40% at 80% 20%, color-mix(in oklab, var(--palette-accent) 14%, transparent), transparent 65%);
  pointer-events: none;
}

.landing-card {
  border-radius: var(--radius-card);
  border: 1px solid var(--surface-line);
  background: var(--surface-base);
  padding: 1.35rem 1.4rem;
  box-shadow: var(--shadow-soft);
  transition:
    transform 0.25s var(--ease-smooth),
    box-shadow 0.25s var(--ease-smooth),
    border-color 0.2s var(--ease-smooth);
}

.landing-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in oklab, var(--surface-line-strong) 65%, var(--palette-primary) 35%);
  box-shadow: var(--shadow-raised);
}

.animate-landing-in {
  animation: landing-in 0.7s var(--ease-smooth) both;
}

.animate-landing-delay-1 {
  animation-delay: 0.08s;
}
.animate-landing-delay-2 {
  animation-delay: 0.16s;
}
.animate-landing-delay-3 {
  animation-delay: 0.24s;
}

@keyframes landing-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .animate-landing-in,
  .landing-card {
    animation: none !important;
    transition: none !important;
  }
}
</style>
