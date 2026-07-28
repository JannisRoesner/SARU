<script setup lang="ts">
import { materialRelationTypes, materialTypes, variantKinds } from '#shared/utils/labels'

const emit = defineEmits<{ anmelden: [] }>()

/** Dekorative Mock-Karten — kein MaterialSummary, absichtlich statisch. */
const materialienMock = [
  {
    t: 'Photosynthese — Arbeitsblatt',
    b: 'Arbeitsblatt',
    f: 'Biologie',
    c: '#3b82f6',
    materialType: 'arbeitsblatt' as const,
    preview: 'datei' as const,
    ext: 'PDF',
    anhaenge: 1,
    tage: 2,
  },
  {
    t: 'Satz des Pythagoras',
    b: 'Präsentation',
    f: 'Mathematik',
    c: '#ef4444',
    materialType: 'praesentation' as const,
    preview: 'datei' as const,
    ext: 'PPTX',
    anhaenge: 1,
    tage: 5,
  },
  {
    t: 'Industrialisierung — Stationen',
    b: 'Unterrichtseinheit',
    f: 'Geschichte',
    c: '#a16207',
    materialType: 'unterrichtsentwurf' as const,
    preview: 'datei' as const,
    ext: 'DOCX',
    anhaenge: 2,
    tage: 12,
  },
  {
    t: 'Chemie 10 — Kurs',
    b: 'Moodle-Kurs',
    f: 'Chemie',
    c: '#8b5cf6',
    materialType: 'moodle_kurs' as const,
    preview: 'moodle' as const,
    ext: 'MBZ',
    anhaenge: 1,
    tage: 3,
  },
]

const features = [
  {
    id: 'materialien',
    icon: 'folder-open',
    fensterTitel: 'Materialien',
    titel: 'Materialien sammeln',
    text: 'Arbeitsblätter, Präsentationen, Moodle-Kursarchive (.mbz / .imscc), H5P-Pakete und weitere Anhänge — mit Varianten, Favoriten und Einordnung nach Fach und Jahrgang — alles an einem Ort.',
    seite: 'rechts' as const,
  },
  {
    id: 'material-detail',
    icon: 'pen-to-square',
    fensterTitel: 'Material',
    titel: 'Materialiendetails pflegen',
    text: 'Titel, Fach, Schlagwörter und Notizen direkt bearbeiten — mit Varianten, Anhängen und automatischem Speichern, während du arbeitest.',
    seite: 'links' as const,
  },
  {
    id: 'loesungen-ki',
    icon: 'wand-magic-sparkles',
    fensterTitel: 'Material · Lösungen',
    titel: 'Lösungen verknüpfen — optional mit KI',
    text: 'Verknüpfe vorhandene Lösungen manuell mit Arbeitsblättern — oder nutze optional die KI, wenn sie in den Einstellungen aktiviert ist: Am Arbeitsblatt startest du „Musterlösung erstellen“, gibst bei Bedarf eine Anweisung an. Die KI legt ein separates Musterlösungs-Material an und verbindet es automatisch. Dort prüfst du den Entwurf in der Dokumentvorschau, korrigierst bei Bedarf und markierst ihn als fachlich geprüft.',
    seite: 'rechts' as const,
  },
  {
    id: 'suche',
    icon: 'magnifying-glass',
    fensterTitel: 'Suche',
    titel: 'Hybrid suchen',
    text: 'Volltext, Ähnlichkeitssuche und optionale Vektorsuche finden Inhalte über Titel, Notizen und extrahierten Dateitext hinweg — auch wenn du dich nur ungefähr erinnerst.',
    seite: 'links' as const,
  },
  {
    id: 'stunden',
    icon: 'chalkboard-user',
    fensterTitel: 'Verlaufsplan',
    titel: 'Stunden planen',
    text: 'Verlaufspläne mit Phasen, Sozialformen und verknüpften Materialien. Phasen per Drag-and-drop sortieren und den roten Faden im Blick behalten.',
    seite: 'rechts' as const,
  },
  {
    id: 'reihen',
    icon: 'layer-group',
    fensterTitel: 'Unterrichtsreihe',
    titel: 'Reihen denken',
    text: 'Unterrichtsreihen als Timeline mit Fortschritt, Druckansicht und wiederverwendbaren Materialien — vom Einstieg bis zur Sicherung.',
    seite: 'links' as const,
  },
  {
    id: 'import',
    icon: 'file-import',
    fensterTitel: 'Schulportal-Import',
    titel: 'Schulportal importieren',
    text: 'Kursmappen analysieren, Dubletten erkennen und zuordnen. Vor dem Übernehmen prüfen, bei Bedarf rückgängig machen.',
    seite: 'rechts' as const,
  },
]

const schritte = [
  { nr: '01', titel: 'Sammeln', text: 'Materialien anlegen, aus dem Schulportal importieren oder Moodle-Kursarchive für dein SchulMoodle ablegen.' },
  { nr: '02', titel: 'Ordnen', text: 'Nach Fach, Thema und Lerngruppe einordnen, damit du alles wiederfindest.' },
  { nr: '03', titel: 'Planen', text: 'Stunden und Reihen mit Phasen und Materialien aufbauen.' },
  { nr: '04', titel: 'Unterrichten', text: 'Schnell finden, wiederverwenden, Fortschritt im Blick behalten.' },
]

const mehr = [
  {
    icon: 'wand-magic-sparkles',
    titel: 'KI-Musterlösungen',
    text: 'Optional Lösungen aus PDF- und Office-Dateien erzeugen — klar als KI kennzeichnen, mit dem Ausgangsmaterial verknüpfen und als geprüft markieren.',
  },
  {
    icon: 'layer-group',
    titel: 'Stapel-Upload',
    text: 'Mehrere PDFs auf einmal hochladen, gemeinsam einordnen und mit optionalen KI-Vorschlägen für Titel und Typ prüfen — vor dem Übernehmen kontrollieren.',
  },
  {
    icon: 'users',
    titel: 'Rollen & Rechte',
    text: 'Lehrkraft und Administration pflegen Materialien, Stunden und Reihen; Lesezugriff bleibt schreibgeschützt. Die Administration verwaltet zusätzlich Benutzer und System.',
  },
  { icon: 'palette', titel: 'Darstellung', text: 'Hell, Dunkel oder System plus ruhige Farbpaletten.' },
  { icon: 'server', titel: 'Self-Hosted', text: 'Deine Daten bleiben in deiner Instanz.' },
  { icon: 'print', titel: 'Druckansicht', text: 'Verlaufspläne und Reihenübersichten sauber für die Mappe drucken.' },
  {
    icon: 'robot',
    titel: 'Lokale KI',
    text: 'Optional Ollama auf deiner Infrastruktur — Musterlösungen, Stapel-Vorschläge und Vektorsuche bleiben unter deiner Kontrolle.',
  },
  { icon: 'shield-halved', titel: 'Datenschutz', text: 'Kein Cloud-Zwang — du bestimmst, wo SARU läuft.' },
]
</script>

<template>
  <div class="landing">
    <header class="landing-nav kein-druck">
      <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="#oben" class="flex items-center gap-2.5 font-semibold tracking-tight">
          <span class="flex size-9 items-center justify-center rounded-xl bg-primary-solid text-primary-contrast">
            <UiIcon name="graduation-cap" />
          </span>
          <span>
            <span class="block leading-none">SARU</span>
            <span class="mt-0.5 block text-[0.65rem] font-normal tracking-[0.08em] text-ink-subtle">
              Unterrichtsarchiv
            </span>
          </span>
        </a>
        <nav class="hidden items-center gap-6 text-sm text-ink-muted md:flex">
          <a href="#funktionen" class="transition-colors hover:text-ink">Funktionen</a>
          <a href="#mehr" class="transition-colors hover:text-ink">Schulalltag</a>
          <a href="#ablauf" class="transition-colors hover:text-ink">So funktioniert's</a>
        </nav>
        <div class="flex items-center gap-1.5">
          <LayoutDarstellungsschalter />
          <UiButton variante="primaer" icon="right-to-bracket" @click="emit('anmelden')">
            Anmelden
          </UiButton>
        </div>
      </div>
    </header>

    <main id="oben">
      <!-- Hero: Marke zuerst, wie bei FreiWerk zentriert -->
      <section class="landing-hero relative overflow-hidden px-4 pt-10 pb-16 sm:px-6 sm:pt-14 sm:pb-20">
        <div class="landing-hero-glow" aria-hidden="true" />
        <div class="landing-hero-karte relative mx-auto max-w-3xl px-6 py-12 text-center sm:px-10 sm:py-16 animate-landing-in">
          <div class="mx-auto flex items-center justify-center gap-3">
            <span class="flex size-12 items-center justify-center rounded-2xl bg-primary-solid text-primary-contrast shadow-soft sm:size-14">
              <UiIcon name="graduation-cap" class="text-xl" />
            </span>
            <span class="text-left">
              <span class="block text-2xl font-semibold tracking-tight text-ink sm:text-3xl">SARU</span>
              <span class="mt-0.5 block text-xs tracking-[0.06em] text-ink-subtle sm:text-sm">
                Unterrichtsarchiv
              </span>
            </span>
          </div>

          <h1 class="mt-8 text-3xl leading-[1.15] tracking-tight text-ink sm:text-4xl lg:text-[2.75rem]">
            Dein Archiv für Materialien,<br class="hidden sm:block" />
            Stunden und Reihen
          </h1>
          <p class="mx-auto mt-4 max-w-xl text-base leading-relaxed text-ink-muted sm:text-lg">
            Sammle, ordne und plane Unterricht an einem Ort —
            mit Suche, Schulportal-Import und optionaler KI.
          </p>

          <p class="landing-akronym mx-auto mt-6 max-w-lg text-sm leading-relaxed sm:text-base">
            <span class="akronym-buchstabe">S</span>ystem zur
            <span class="akronym-buchstabe">A</span>rchivierung von
            <span class="akronym-buchstabe">R</span>eihen und
            <span class="akronym-buchstabe">U</span>nterrichtsmaterialien
          </p>

          <div class="mt-8 flex flex-wrap justify-center gap-3">
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

      <!-- Feature-Fenster, analog zu FreiWerk -->
      <section id="funktionen" class="border-t border-line py-16 sm:py-24">
        <div class="mx-auto max-w-6xl px-4 sm:px-6">
          <div class="mx-auto mb-14 max-w-2xl text-center sm:mb-20">
            <p class="seitenkopf-kicker justify-center">Funktionen</p>
            <h2 class="mt-2 text-3xl tracking-tight text-ink sm:text-4xl">
              So sieht die Arbeit mit SARU aus
            </h2>
            <p class="mt-3 text-sm leading-relaxed text-ink-muted sm:text-base">
              Die wichtigsten Oberflächen — so, wie du sie im Alltag nutzt.
            </p>
          </div>

          <div class="flex flex-col gap-20 sm:gap-28">
            <article
              v-for="f in features"
              :key="f.id"
              class="grid min-w-0 items-center gap-8 lg:grid-cols-2 lg:gap-12"
            >
              <div class="min-w-0" :class="f.seite === 'links' ? 'lg:order-2' : ''">
                <span class="mb-4 flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary-strong">
                  <UiIcon :name="f.icon" fest />
                </span>
                <h3 class="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                  {{ f.titel }}
                </h3>
                <p class="mt-3 max-w-md text-sm leading-relaxed text-ink-muted sm:text-base">
                  {{ f.text }}
                </p>
              </div>

              <div class="min-w-0 overflow-hidden" :class="f.seite === 'links' ? 'lg:order-1' : ''" aria-hidden="true">
                <StartLandingFenster :titel="f.fensterTitel">
                  <!-- Materialien -->
                  <div v-if="f.id === 'materialien'" class="space-y-2.5 p-4 sm:p-5">
                    <div class="mb-1 flex flex-wrap gap-2">
                      <div class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-xs text-ink-subtle">
                        <UiIcon name="magnifying-glass" fest class="shrink-0 opacity-70" />
                        <span class="truncate">Titel, Inhalt, Schlagwort …</span>
                      </div>
                      <span class="filter-chip filter-chip-aktiv">
                        <UiIcon name="star" fest /> Favoriten
                      </span>
                    </div>
                    <div
                      v-for="m in materialienMock"
                      :key="m.t"
                      class="karte flex items-center gap-3 p-3"
                    >
                      <div
                        class="relative h-14 w-11 shrink-0 overflow-hidden rounded-md border border-line bg-surface-sunken shadow-sm"
                      >
                        <span
                          class="absolute inset-0 flex flex-col items-center justify-center gap-1 text-ink-subtle"
                          :class="
                            m.preview === 'moodle'
                              ? 'landing-moodle-vorschau'
                              : 'bg-gradient-to-b from-surface to-surface-sunken'
                          "
                        >
                          <UiIcon
                            :name="m.preview === 'moodle' ? 'graduation-cap' : 'file'"
                            fest
                            class="text-lg opacity-80"
                          />
                          <span class="text-[0.6rem] font-semibold uppercase tracking-wide">
                            {{ m.ext }}
                          </span>
                        </span>
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="flex items-start gap-2">
                          <p class="min-w-0 flex-1 truncate text-sm font-medium text-ink">{{ m.t }}</p>
                          <UiIcon name="star" stil="far" fest class="shrink-0 text-ink-subtle" />
                        </div>
                        <div class="mt-2 flex flex-wrap items-center gap-1.5">
                          <UiBadge
                            groesse="sm"
                            :ton="materialTypes.tone(m.materialType)"
                            :icon="materialTypes.icon(m.materialType) ?? undefined"
                          >
                            {{ m.b }}
                          </UiBadge>
                          <UiBadge groesse="sm" :farbe="m.c">
                            {{ m.f }}
                          </UiBadge>
                        </div>
                        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-subtle">
                          <span class="flex items-center gap-1">
                            <UiIcon name="paperclip" fest />
                            {{ m.anhaenge }}
                            {{ m.anhaenge === 1 ? 'Anhang' : 'Anhänge' }}
                          </span>
                          <span class="flex items-center gap-1">
                            <UiIcon name="clock-rotate-left" fest />
                            vor {{ m.tage }} Tagen
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Material-Detail -->
                  <div v-else-if="f.id === 'material-detail'" class="space-y-3 p-4 sm:p-5">
                    <p class="flex items-center gap-1.5 text-[0.7rem] text-ink-subtle">
                      <UiIcon name="arrow-left" fest />
                      Materialien
                    </p>

                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0">
                        <p class="text-[0.65rem] font-medium tracking-[0.14em] text-ink-subtle uppercase">
                          Material
                        </p>
                        <p class="truncate text-sm font-semibold text-ink">Photosynthese — Arbeitsblatt</p>
                        <div class="mt-2 flex flex-wrap gap-1.5">
                          <UiBadge
                            groesse="sm"
                            :ton="materialTypes.tone('arbeitsblatt')"
                            :icon="materialTypes.icon('arbeitsblatt') ?? undefined"
                          >
                            Arbeitsblatt
                          </UiBadge>
                          <UiBadge groesse="sm" farbe="#3b82f6">
                            Biologie
                          </UiBadge>
                        </div>
                      </div>
                      <span class="shrink-0 rounded-md bg-success-soft px-2 py-0.5 text-[0.65rem] font-medium text-success-strong">
                        Gespeichert
                      </span>
                    </div>

                    <!-- Dokumentvorschau -->
                    <div class="overflow-hidden rounded-xl border border-line bg-surface shadow-soft">
                      <div class="flex items-center gap-2 border-b border-line bg-surface-sunken/60 px-3 py-2">
                        <UiIcon name="eye" fest class="text-xs text-ink-subtle" />
                        <span class="text-xs font-medium text-ink">Dokumentvorschau</span>
                        <UiIcon name="chevron-down" fest class="ml-auto text-[0.65rem] text-ink-subtle" />
                      </div>
                      <div class="flex items-center gap-3 p-3">
                        <div class="relative h-12 w-9 shrink-0 overflow-hidden rounded-md border border-line bg-gradient-to-b from-surface to-surface-sunken shadow-sm">
                          <span class="absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-ink-subtle">
                            <UiIcon name="file" fest class="text-sm opacity-80" />
                            <span class="text-[0.55rem] font-semibold uppercase tracking-wide">PDF</span>
                          </span>
                        </div>
                        <div class="min-w-0 flex-1">
                          <p class="truncate text-xs font-medium text-ink">photosynthese_ab.pdf</p>
                          <p class="text-[0.65rem] text-ink-subtle">842 KB</p>
                        </div>
                      </div>
                    </div>

                    <!-- Angaben -->
                    <div class="overflow-hidden rounded-xl border border-line bg-surface shadow-soft">
                      <div class="flex items-center gap-2 border-b border-line bg-surface-sunken/60 px-3 py-2">
                        <UiIcon name="pen-to-square" fest class="text-xs text-ink-subtle" />
                        <span class="text-xs font-medium text-ink">Angaben</span>
                        <UiIcon name="chevron-down" fest class="ml-auto text-[0.65rem] text-ink-subtle" />
                      </div>
                      <div class="space-y-2.5 p-3">
                        <div>
                          <p class="text-[0.65rem] font-medium text-ink-subtle">Titel</p>
                          <div class="mt-0.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink">
                            Photosynthese — Arbeitsblatt
                          </div>
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                          <div>
                            <p class="text-[0.65rem] font-medium text-ink-subtle">Materialart</p>
                            <div class="mt-0.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink">
                              Arbeitsblatt
                            </div>
                          </div>
                          <div>
                            <p class="text-[0.65rem] font-medium text-ink-subtle">Schulform</p>
                            <div class="mt-0.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-subtle">
                              –
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- Varianten & Anhänge -->
                    <div class="overflow-hidden rounded-xl border border-line bg-surface shadow-soft">
                      <div class="flex items-center gap-2 border-b border-line bg-surface-sunken/60 px-3 py-2">
                        <UiIcon name="code-branch" fest class="text-xs text-ink-subtle" />
                        <span class="text-xs font-medium text-ink">Varianten & Anhänge</span>
                        <UiIcon name="chevron-up" fest class="ml-auto text-[0.65rem] text-ink-subtle" />
                      </div>
                      <div class="space-y-2 p-3">
                        <div class="rounded-lg border border-line bg-surface-sunken/40 p-2.5">
                          <div class="mb-2 flex items-center gap-1.5">
                            <p class="text-xs font-medium text-ink">Standard</p>
                            <UiBadge groesse="sm" ton="primary">Standard</UiBadge>
                          </div>
                          <p class="mb-2 text-[0.65rem] text-ink-subtle">
                            {{ variantKinds.label('standard') }}
                          </p>
                          <div class="flex items-center gap-2 rounded-lg bg-surface px-2.5 py-1.5 text-xs">
                            <UiIcon name="file" fest class="text-ink-subtle" />
                            <span class="min-w-0 flex-1 truncate text-ink">photosynthese_ab.pdf</span>
                            <span class="text-[0.65rem] text-ink-subtle">842 KB</span>
                          </div>
                        </div>
                        <div class="rounded-lg border border-line bg-surface-sunken/40 p-2.5">
                          <div class="mb-2 flex items-center gap-1.5">
                            <p class="text-xs font-medium text-ink">Leichte Sprache</p>
                          </div>
                          <p class="mb-2 text-[0.65rem] text-ink-subtle">
                            {{ variantKinds.label('differenzierung') }}
                          </p>
                          <div class="flex items-center gap-2 rounded-lg bg-surface px-2.5 py-1.5 text-xs">
                            <UiIcon name="file" fest class="text-ink-subtle" />
                            <span class="min-w-0 flex-1 truncate text-ink">photosynthese_leichte_sprache.pdf</span>
                            <span class="text-[0.65rem] text-ink-subtle">524 KB</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Lösungen & KI -->
                  <div v-else-if="f.id === 'loesungen-ki'" class="min-w-0 space-y-3 p-4 sm:p-5">
                    <span class="landing-ki-optional-chip">
                      <UiIcon name="wand-magic-sparkles" fest class="shrink-0" />
                      <span class="min-w-0">Optional · KI in Einstellungen aktivierbar</span>
                    </span>

                    <!-- Arbeitsblatt: Ausgangsmaterial -->
                    <div class="overflow-hidden rounded-xl border border-line bg-surface shadow-soft">
                      <div class="flex flex-col gap-2 border-b border-line bg-surface-sunken/40 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between">
                        <div class="min-w-0">
                          <p class="text-[0.65rem] font-medium tracking-[0.14em] text-ink-subtle uppercase">
                            Arbeitsblatt
                          </p>
                          <p class="truncate text-xs font-semibold text-ink">Photosynthese — Arbeitsblatt</p>
                          <div class="mt-1.5 flex flex-wrap gap-1">
                            <UiBadge
                              groesse="sm"
                              :ton="materialTypes.tone('arbeitsblatt')"
                              :icon="materialTypes.icon('arbeitsblatt') ?? undefined"
                            >
                              Arbeitsblatt
                            </UiBadge>
                            <UiBadge groesse="sm" farbe="#3b82f6">
                              Biologie
                            </UiBadge>
                          </div>
                        </div>
                        <span class="inline-flex h-7 w-fit max-w-full shrink-0 items-center gap-1 rounded-lg border border-line bg-surface px-2 text-[0.65rem] font-medium text-ink">
                          <UiIcon name="wand-magic-sparkles" fest class="shrink-0 text-ki-strong" />
                          <span class="truncate">Musterlösung erstellen</span>
                        </span>
                      </div>

                      <!-- KI-Modal (wie in [id].vue) -->
                      <div class="landing-ki-modal mx-3 my-2.5 min-w-0 rounded-lg border border-line bg-surface p-3 shadow-soft">
                        <div class="mb-2 flex min-w-0 items-center gap-2">
                          <UiIcon name="wand-magic-sparkles" class="shrink-0 text-ki-strong" />
                          <p class="min-w-0 text-xs font-semibold text-ink">Musterlösung erstellen</p>
                        </div>
                        <p class="mb-2 text-[0.65rem] leading-relaxed text-ink-muted">
                          KI wertet die Quelldatei aus und erzeugt ein herunterladbares Dokument — als verknüpfte Musterlösung.
                        </p>
                        <p class="mb-1 text-[0.65rem] font-medium text-ink-muted">
                          Zusätzliche Anweisung
                          <span class="font-normal text-ink-subtle">(optional)</span>
                        </p>
                        <div class="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-[0.7rem] leading-relaxed break-words text-ink-subtle">
                          Lücken knapp ausfüllen, Erwartungshorizont für Klasse 8 …
                        </div>
                        <div class="mt-2.5 flex flex-wrap justify-end gap-1.5">
                          <span class="inline-flex h-7 items-center rounded-lg px-2.5 text-[0.65rem] text-ink-muted">
                            Abbrechen
                          </span>
                          <span class="inline-flex h-7 max-w-full items-center gap-1 rounded-lg bg-primary-solid px-2.5 text-[0.65rem] font-medium text-primary-contrast">
                            <UiIcon name="wand-magic-sparkles" fest class="shrink-0" />
                            <span class="truncate">Musterlösung erstellen</span>
                          </span>
                        </div>
                      </div>

                      <!-- Verknüpfungen (Listenstil wie [id].vue) -->
                      <div class="border-t border-line px-3 py-2.5">
                        <div class="mb-2 flex items-center justify-between gap-2">
                          <p class="flex items-center gap-1.5 text-[0.65rem] font-medium tracking-[0.14em] text-ink-subtle uppercase">
                            <UiIcon name="link" fest />
                            Verknüpfungen
                          </p>
                          <span class="text-[0.65rem] text-ink-subtle">+ Verknüpfen</span>
                        </div>
                        <ul class="space-y-1.5">
                          <li class="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5">
                            <UiBadge
                              groesse="sm"
                              :ton="materialRelationTypes.tone('musterloesung')"
                              :icon="materialRelationTypes.icon('musterloesung') ?? undefined"
                            >
                              Musterlösung
                            </UiBadge>
                            <span class="min-w-0 flex-1 truncate text-xs font-medium text-primary">
                              Photosynthese — Musterlösung
                            </span>
                          </li>
                        </ul>
                        <p class="mt-1.5 text-[0.6rem] text-ink-subtle">
                          Oder manuell: bestehende Lösung per „Verknüpfen“ zuordnen.
                        </p>
                      </div>
                    </div>

                    <!-- Separates Musterlösungs-Material -->
                    <div class="overflow-hidden rounded-xl border border-line bg-surface shadow-soft">
                      <div class="border-b border-line bg-surface-sunken/40 px-3 py-2.5">
                        <p class="text-[0.65rem] font-medium tracking-[0.14em] text-ink-subtle uppercase">
                          Musterlösungs-Material
                        </p>
                        <p class="truncate text-xs font-semibold text-ink">Photosynthese — Musterlösung</p>
                        <div class="mt-1.5 flex flex-wrap gap-1">
                          <UiBadge
                            groesse="sm"
                            :ton="materialTypes.tone('musterloesung')"
                            :icon="materialTypes.icon('musterloesung') ?? undefined"
                          >
                            Musterlösung
                          </UiBadge>
                          <UiBadge groesse="sm" ton="ki" icon="robot">
                            KI
                          </UiBadge>
                          <UiBadge groesse="sm" ton="gruen" icon="circle-check">
                            Geprüft
                          </UiBadge>
                        </div>
                      </div>

                      <div class="p-3">
                        <div class="flex items-center gap-2 border-b border-line bg-surface-sunken/60 px-2.5 py-1.5 -mx-3 -mt-3 mb-2.5">
                          <UiIcon name="eye" fest class="text-[0.65rem] text-ink-subtle" />
                          <span class="text-[0.65rem] font-medium text-ink">Dokumentvorschau</span>
                        </div>
                        <div class="flex items-center gap-3">
                          <div class="relative h-12 w-9 shrink-0 overflow-hidden rounded-md border border-line bg-gradient-to-b from-surface to-surface-sunken shadow-sm">
                            <span class="absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-ink-subtle">
                              <UiIcon name="file" fest class="text-sm opacity-80" />
                              <span class="text-[0.55rem] font-semibold uppercase tracking-wide">PDF</span>
                            </span>
                          </div>
                          <div class="min-w-0 flex-1">
                            <p class="truncate text-xs font-medium text-ink">photosynthese_loesung.pdf</p>
                            <p class="text-[0.65rem] text-ink-subtle">KI-Dokument · 612 KB</p>
                          </div>
                        </div>
                        <div class="mt-2.5 flex flex-wrap gap-1.5">
                          <span class="inline-flex h-7 items-center gap-1 rounded-lg bg-primary-solid px-2.5 text-[0.65rem] font-medium text-primary-contrast">
                            <UiIcon name="eye" fest />
                            Vorschau &amp; korrigieren
                          </span>
                          <span class="inline-flex h-7 items-center gap-1 rounded-lg border border-line bg-surface px-2.5 text-[0.65rem] text-ink">
                            <UiIcon name="download" fest />
                            Download
                          </span>
                        </div>
                        <div class="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-sunken/60 px-2.5 py-2">
                          <div>
                            <p class="text-[0.7rem] font-medium text-ink">Fachlich geprüft</p>
                            <p class="text-[0.6rem] text-ink-subtle">KI-Musterlösung als kontrolliert markieren</p>
                          </div>
                          <span class="shrink-0 rounded-full bg-primary-solid px-2 py-0.5 text-[0.6rem] font-medium text-primary-contrast">
                            an
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Stunden / Verlauf -->
                  <div v-else-if="f.id === 'stunden'" class="p-4 sm:p-5">
                    <div class="mb-3 flex items-baseline justify-between gap-2">
                      <div>
                        <p class="text-[0.65rem] font-medium tracking-[0.14em] text-ink-subtle uppercase">
                          Unterrichtsstunde
                        </p>
                        <p class="text-sm font-semibold text-ink">Photosynthese — Einstieg</p>
                      </div>
                      <span class="rounded-md bg-primary-soft px-2 py-0.5 text-[0.7rem] font-medium text-primary-strong">
                        45 Min.
                      </span>
                    </div>
                    <div class="space-y-2">
                      <div
                        v-for="(p, i) in [
                          { n: 'Einstieg', m: '10 Min.', s: 'Plenum', i: 'Alltagsbezug Pflanzen' },
                          { n: 'Erarbeitung', m: '25 Min.', s: 'Partnerarbeit', i: 'Arbeitsblatt Experiment' },
                          { n: 'Sicherung', m: '10 Min.', s: 'Plenum', i: 'Tafelbild zusammenfassen' },
                        ]"
                        :key="p.n"
                        class="overflow-hidden rounded-xl border border-line bg-surface shadow-soft"
                      >
                        <div class="flex items-center gap-2 border-b border-line bg-surface-sunken/60 px-3 py-1.5">
                          <UiIcon name="grip-vertical" class="text-ink-subtle" />
                          <span class="text-xs font-semibold text-ink">{{ i + 1 }}. {{ p.n }}</span>
                          <span class="ml-auto text-[0.7rem] text-ink-subtle">{{ p.m }} · {{ p.s }}</span>
                        </div>
                        <p class="px-3 py-2 text-xs text-ink-muted">{{ p.i }}</p>
                      </div>
                    </div>
                  </div>

                  <!-- Reihen -->
                  <div v-else-if="f.id === 'reihen'" class="p-4 sm:p-5">
                    <div class="mb-4">
                      <div class="flex items-center justify-between gap-2">
                        <p class="text-sm font-semibold text-ink">Photosynthese & Zellatmung</p>
                        <span class="rounded-md bg-success-soft px-2 py-0.5 text-[0.7rem] font-medium text-success-strong">
                          Aktiv
                        </span>
                      </div>
                      <div class="mt-2 h-2 overflow-hidden rounded-full bg-surface-sunken">
                        <div class="h-full w-3/5 rounded-full bg-primary-solid" />
                      </div>
                      <p class="mt-1 text-[0.7rem] text-ink-subtle">6 von 10 Stunden · 60&nbsp;%</p>
                    </div>
                    <div class="relative space-y-2 pl-6">
                      <div class="absolute top-1 bottom-1 left-2 w-px bg-line" />
                      <div
                        v-for="(s, i) in [
                          { t: 'Einstieg & Vorwissen', d: 'erledigt' },
                          { t: 'Lichtreaktion', d: 'erledigt' },
                          { t: 'Calvin-Zyklus', d: 'aktuell' },
                          { t: 'Vergleich Zellatmung', d: 'geplant' },
                        ]"
                        :key="s.t"
                        class="relative rounded-xl border border-line bg-surface px-3 py-2 shadow-soft"
                      >
                        <span
                          class="absolute top-2.5 -left-[1.35rem] flex size-5 items-center justify-center rounded-full text-[0.65rem] font-semibold"
                          :class="
                            s.d === 'aktuell'
                              ? 'bg-primary-solid text-primary-contrast'
                              : s.d === 'erledigt'
                                ? 'bg-success-soft text-success-strong'
                                : 'bg-surface-sunken text-ink-subtle'
                          "
                        >{{ i + 1 }}</span>
                        <p class="text-xs font-medium text-ink">{{ s.t }}</p>
                      </div>
                    </div>
                  </div>

                  <!-- Suche -->
                  <div v-else-if="f.id === 'suche'" class="p-4 sm:p-5">
                    <div class="rounded-xl border border-line bg-surface shadow-raised">
                      <div class="flex items-center gap-2 border-b border-line px-3 py-2.5">
                        <UiIcon name="magnifying-glass" class="text-ink-subtle" />
                        <span class="text-sm text-ink">Photosynthese</span>
                        <kbd class="ml-auto rounded border border-line px-1.5 py-0.5 text-[0.65rem] text-ink-subtle">
                          Ctrl K
                        </kbd>
                      </div>
                      <div class="divide-y divide-line">
                        <div
                          v-for="t in [
                            { art: 'Material', t: 'Photosynthese — Arbeitsblatt', vor: '…Lichtreaktion und ', mark: 'Photosynthese', nach: '…' },
                            { art: 'Stunde', t: 'Photosynthese — Einstieg', vor: 'Einstieg in die ', mark: 'Photosynthese', nach: '' },
                            { art: 'Reihe', t: 'Photosynthese & Zellatmung', vor: 'Reihe zur ', mark: 'Photosynthese', nach: '' },
                          ]"
                          :key="t.t"
                          class="px-3 py-2.5"
                        >
                          <div class="flex items-center gap-2">
                            <span class="rounded-md bg-primary-soft px-1.5 py-0.5 text-[0.65rem] font-medium text-primary-strong">
                              {{ t.art }}
                            </span>
                            <span class="truncate text-xs font-medium text-ink">{{ t.t }}</span>
                          </div>
                          <p class="mt-1 text-[0.7rem] text-ink-muted">
                            {{ t.vor }}<mark>{{ t.mark }}</mark>{{ t.nach }}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Import -->
                  <div v-else-if="f.id === 'import'" class="p-4 sm:p-5">
                    <div class="mb-4 flex gap-1">
                      <span
                        v-for="(st, i) in ['Upload', 'Zuordnung', 'Import', 'Ergebnis']"
                        :key="st"
                        class="flex-1 rounded-lg px-1 py-1.5 text-center text-[0.65rem] font-medium"
                        :class="i === 1 ? 'bg-primary-solid text-primary-contrast' : 'bg-surface-sunken text-ink-subtle'"
                      >{{ st }}</span>
                    </div>
                    <div class="rounded-xl border border-dashed border-line-strong bg-surface px-4 py-5 text-center">
                      <UiIcon name="cloud-arrow-up" class="mb-2 text-2xl text-primary" />
                      <p class="text-xs font-medium text-ink">Kursmappe.zip</p>
                      <p class="mt-0.5 text-[0.7rem] text-ink-subtle">18 Dateien · 3 Dubletten erkannt</p>
                    </div>
                    <div class="mt-3 space-y-2">
                      <div class="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2 text-xs">
                        <span class="text-ink-muted">Fach</span>
                        <span class="font-medium text-ink">Biologie</span>
                      </div>
                      <div class="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2 text-xs">
                        <span class="text-ink-muted">Dubletten verknüpfen</span>
                        <span class="rounded-full bg-primary-solid px-2 py-0.5 text-[0.65rem] text-primary-contrast">an</span>
                      </div>
                    </div>
                  </div>
                </StartLandingFenster>
              </div>
            </article>
          </div>
        </div>
      </section>

      <!-- Warum SARU heißt -->
      <section id="name" class="border-t border-line bg-surface/60 py-16 sm:py-20">
        <div class="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <p class="seitenkopf-kicker justify-center">Der Name</p>
          <h2 class="mt-2 text-3xl tracking-tight text-ink sm:text-4xl">
            Warum SARU?
          </h2>
          <p class="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-ink sm:text-xl">
            <span class="akronym-buchstabe">S</span>ystem zur
            <span class="akronym-buchstabe">A</span>rchivierung von
            <span class="akronym-buchstabe">R</span>eihen und
            <span class="akronym-buchstabe">U</span>nterrichtsmaterialien
          </p>
          <p class="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-ink-muted sm:text-base">
            Kurz gesagt: ein Archiv, das Materialien, Stunden und Reihen zusammenhält —
            damit Vorbereitung nicht bei jedem Schuljahr neu beginnt.
          </p>
        </div>
      </section>

      <!-- Und mehr -->
      <section id="mehr" class="border-t border-line py-16 sm:py-24">
        <div class="mx-auto max-w-6xl px-4 sm:px-6">
          <div class="seitenkopf mb-12 !max-w-2xl">
            <p class="seitenkopf-kicker">Und mehr</p>
            <h2 class="text-3xl tracking-tight text-ink sm:text-4xl">
              Alles für den Schulalltag
            </h2>
          </div>
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <article v-for="eintrag in mehr" :key="eintrag.titel" class="landing-card">
              <UiIcon :name="eintrag.icon" class="mb-3 text-primary" />
              <h3 class="font-semibold text-ink">{{ eintrag.titel }}</h3>
              <p class="mt-1.5 text-sm text-ink-muted">{{ eintrag.text }}</p>
            </article>
          </div>
        </div>
      </section>

      <!-- Ablauf -->
      <section id="ablauf" class="border-t border-line bg-surface/60 py-16 sm:py-24">
        <div class="mx-auto max-w-6xl px-4 sm:px-6">
          <div class="seitenkopf mb-12 !max-w-2xl">
            <p class="seitenkopf-kicker">Ablauf</p>
            <h2 class="text-3xl tracking-tight text-ink sm:text-4xl">
              Vom Fundstück zum Unterricht
            </h2>
            <p class="mt-3 text-sm leading-relaxed text-ink-muted sm:text-base">
              Vier Schritte, nachvollziehbar und ohne Umwege.
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

      <!-- CTA -->
      <section class="py-20 sm:py-28">
        <div class="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <p class="seitenkopf-kicker justify-center">Bereit?</p>
          <h2 class="mt-2 text-3xl tracking-tight text-ink sm:text-4xl">
            Starte mit deinem Unterrichtsarchiv
          </h2>
          <p class="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-ink-muted sm:text-base">
            Melde dich an, lege Materialien an oder importiere eine Kursmappe aus dem Schulportal.
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
        <span>
          SARU ·
          <span class="akronym-buchstabe !text-[0.7rem]">S</span>ystem zur
          <span class="akronym-buchstabe !text-[0.7rem]">A</span>rchivierung von
          <span class="akronym-buchstabe !text-[0.7rem]">R</span>eihen und
          <span class="akronym-buchstabe !text-[0.7rem]">U</span>nterrichtsmaterialien
        </span>
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
  inset: -10% -20% auto;
  height: 85%;
  background:
    radial-gradient(ellipse 55% 55% at 30% 20%, color-mix(in oklab, var(--palette-primary) 18%, transparent), transparent 70%),
    radial-gradient(ellipse 45% 45% at 75% 35%, color-mix(in oklab, var(--palette-accent) 14%, transparent), transparent 65%);
  pointer-events: none;
}

.landing-hero-karte {
  border-radius: 1.25rem;
  border: 1px solid color-mix(in oklab, var(--surface-line) 80%, var(--palette-primary) 20%);
  background:
    linear-gradient(
      145deg,
      color-mix(in oklab, var(--surface-raised) 92%, var(--palette-primary-soft) 8%),
      var(--surface-base) 55%,
      color-mix(in oklab, var(--surface-base) 90%, var(--palette-accent-soft) 10%)
    );
  box-shadow: var(--shadow-raised);
}

.landing-akronym {
  color: var(--text-muted);
}

.akronym-buchstabe {
  display: inline;
  font-weight: 700;
  color: var(--palette-primary);
  font-size: 1.05em;
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

:deep(mark) {
  border-radius: 0.2em;
  background: var(--palette-accent-soft);
  color: var(--palette-accent-strong);
  padding: 0 0.15em;
}

@media (prefers-reduced-motion: reduce) {
  .animate-landing-in,
  .landing-card {
    animation: none !important;
    transition: none !important;
  }
}

.landing-moodle-vorschau {
  background: linear-gradient(160deg, rgb(249 128 18 / 0.14), var(--surface-sunken));
  color: #f98012;
}

.landing-ki-optional-chip {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 0.35rem;
  border-radius: 999px;
  border: 1px solid color-mix(in oklab, var(--badge-ki) 25%, var(--surface-line));
  background: color-mix(in oklab, var(--badge-ki-soft) 55%, var(--surface-base));
  padding: 0.25rem 0.65rem;
  font-size: 0.65rem;
  font-weight: 500;
  color: var(--badge-ki-strong);
}

.landing-ki-modal {
  border-style: dashed;
  border-color: color-mix(in oklab, var(--badge-ki) 22%, var(--surface-line));
  background: color-mix(in oklab, var(--badge-ki-soft) 18%, var(--surface-base));
}
</style>
